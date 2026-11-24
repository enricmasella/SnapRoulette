import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/**
 * File System Access API: `window.showDirectoryPicker`, `queryPermission` y los
 * iteradores asíncronos de `FileSystemDirectoryHandle` todavía no forman parte de
 * lib.dom, así que declaramos únicamente la superficie que usamos aquí. Es
 * declaración de tipos, no una aserción: el narrowing se hace con `instanceof`.
 */
declare global {
  interface FileSystemHandlePermissionDescriptor {
    mode?: "read" | "write";
  }

  interface FileSystemHandle {
    queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  }

  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<FileSystemHandle>;
    values(): AsyncIterableIterator<FileSystemHandle>;
  }

  interface DirectoryPickerOptions {
    id?: string;
    mode?: "read" | "write";
  }

  interface Window {
    showDirectoryPicker?(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
  }
}

export type PhotoPoolStatus = "idle" | "granting" | "reading" | "ready" | "error";
export type PhotoPoolMode = "photos" | "videos" | "mixed";

export interface PhotoPoolOptions {
  /** Número de archivos que forman el pool (poolSizeFor). */
  size: number;
  /** Valor del atributo `accept` para el selector de respaldo. */
  accept: string;
  /** Tipo de medio admitido por la sala. */
  mode: PhotoPoolMode;
}

export interface PhotoPoolController {
  status: PhotoPoolStatus;
  error: string | null;
  selected: File[];
  allFiles: File[];
  grant: () => Promise<void>;
  openFilesPicker: () => void;
  openFolderPicker: () => void;
  rerollAll: () => void;
  rerollOne: (index: number) => void;
  ingest: (files: File[], merge?: boolean) => void;
  reset: () => void;
  fallbackRef: RefObject<HTMLInputElement | null>;
}

/** Techo de archivos leídos de la biblioteca: evita congelar el navegador. */
const MAX_LIBRARY_FILES = 2000;
const HANDLE_DB_NAME = "snaproulette";
const HANDLE_DB_VERSION = 1;
const HANDLE_STORE = "photo-handles";
const HANDLE_KEY = "dir";
/** HEIC/HEIF suelen venir sin `type`, así que la extensión también cuenta. */
const HEIC_EXTENSION = /\.(heic|heif)$/i;

type DirectoryPicker = (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;

interface PhotoPoolState {
  status: PhotoPoolStatus;
  error: string | null;
  selected: File[];
  allFiles: File[];
}

const INITIAL_STATE: PhotoPoolState = {
  status: "idle",
  error: null,
  selected: [],
  allFiles: [],
};

/**
 * Devuelve el selector nativo si existe y no estamos embebidos en un iframe de
 * otro origen (allí el permiso siempre falla), y `null` en caso contrario.
 */
function pickDirectoryIfPossible(): DirectoryPicker | null {
  const picker = window.showDirectoryPicker;
  if (typeof picker !== "function") return null;
  try {
    if (window.self !== window.top) return null;
  } catch {
    return null; // iframe de origen cruzado: el permiso siempre fallaría
  }
  return picker;
}

function isPhotoFile(file: File): boolean {
  return file.type.startsWith("image/") || HEIC_EXTENSION.test(file.name);
}

function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/");
}

function isWantedMedia(file: File, mode: PhotoPoolMode): boolean {
  if (mode === "photos") return isPhotoFile(file);
  if (mode === "videos") return isVideoFile(file);
  return isPhotoFile(file) || isVideoFile(file);
}

function fileKey(file: File): string {
  return `${file.name}|${file.size}|${file.type}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "error desconocido";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function notEnoughMessage(size: number, found: number): string {
  return `No hay suficientes archivos en la carpeta: se necesitan ${size} y solo hay ${found}.`;
}

/** Fisher-Yates sobre una copia: devuelve `size` archivos al azar. */
function sampleRandom(files: File[], size: number): File[] {
  const shuffled = [...files];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const current = shuffled[i];
    const picked = shuffled[j];
    if (current === undefined || picked === undefined) continue;
    shuffled[i] = picked;
    shuffled[j] = current;
  }
  return shuffled.slice(0, size);
}

/** Recorre la carpeta (y sus subcarpetas) quedándose con los medios admitidos. */
async function readAllMedia(dir: FileSystemDirectoryHandle, mode: PhotoPoolMode): Promise<File[]> {
  const found: File[] = [];
  const walk = async (current: FileSystemDirectoryHandle): Promise<void> => {
    for await (const entry of current.values()) {
      if (found.length >= MAX_LIBRARY_FILES) return;
      if (entry instanceof FileSystemDirectoryHandle) {
        await walk(entry);
        continue;
      }
      if (!(entry instanceof FileSystemFileHandle)) continue;
      const file = await entry.getFile();
      if (isWantedMedia(file, mode)) found.push(file);
    }
  };
  await walk(dir);
  return found;
}

/* ── Persistencia del handle en IndexedDB (sin dependencias) ─────────────── */

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB no disponible"));
  });
}

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DB_NAME, HANDLE_DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(HANDLE_STORE)) {
        request.result.createObjectStore(HANDLE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB no disponible"));
    request.onblocked = () => reject(new Error("IndexedDB bloqueada"));
  });
}

function isDirectoryHandle(value: unknown): value is FileSystemDirectoryHandle {
  return (
    typeof value === "object" && value !== null && "kind" in value && value.kind === "directory"
  );
}

async function storeDirHandle(dir: FileSystemDirectoryHandle): Promise<void> {
  const db = await openHandleDb();
  try {
    await requestResult(
      db.transaction(HANDLE_STORE, "readwrite").objectStore(HANDLE_STORE).put(dir, HANDLE_KEY),
    );
  } finally {
    db.close();
  }
}

async function readStoredDirHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openHandleDb();
  try {
    const stored: unknown = await requestResult(
      db.transaction(HANDLE_STORE, "readonly").objectStore(HANDLE_STORE).get(HANDLE_KEY),
    );
    return isDirectoryHandle(stored) ? stored : null;
  } finally {
    db.close();
  }
}

async function readPermission(dir: FileSystemDirectoryHandle): Promise<PermissionState> {
  const query = dir.queryPermission;
  if (query === undefined) return "prompt";
  try {
    return await query.call(dir, { mode: "read" });
  } catch {
    return "denied";
  }
}

/**
 * Pool de fotos local: pide acceso a la biblioteca una vez, elige `size` archivos
 * al azar y deja que el jugador tire de nuevo. Nada se sube hasta que la pantalla
 * llama a `game.uploadPool`.
 */
export function usePhotoPool({ size, accept, mode }: PhotoPoolOptions): PhotoPoolController {
  const [state, setState] = useState<PhotoPoolState>(INITIAL_STATE);
  const fallbackRef = useRef<HTMLInputElement | null>(null);
  // Últimos valores de las opciones: los callbacks deben ser estables.
  const optsRef = useRef({ size, accept, mode });
  optsRef.current = { size, accept, mode };

  /** Transiciona a "ready" con una selección nueva, o a "error" si no alcanza. */
  const selectFrom = useCallback((files: File[]): void => {
    const wanted = optsRef.current.size;
    if (files.length < wanted) {
      setState({
        status: "error",
        error: notEnoughMessage(wanted, files.length),
        selected: [],
        allFiles: files,
      });
      return;
    }
    setState({
      status: "ready",
      error: null,
      allFiles: files,
      selected: sampleRandom(files, wanted),
    });
  }, []);

  /** Respaldo para Safari/Firefox/iOS: input con `webkitdirectory` + `directory`. */
  const openFallback = useCallback((): void => {
    const input = fallbackRef.current;
    if (input === null) return;
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
    input.setAttribute("accept", optsRef.current.accept);
    input.click();
  }, []);

  /** Abre el selector estándar de fotos/vídeos (galería en móviles / archivos múltiples). */
  const openFilesPicker = useCallback((): void => {
    const input = fallbackRef.current;
    if (input === null) return;
    input.removeAttribute("webkitdirectory");
    input.removeAttribute("directory");
    input.setAttribute("accept", optsRef.current.accept);
    input.click();
  }, []);

  /** Abre el selector de carpetas (directorio nativo o fallback). */
  const openFolderPicker = useCallback(async (): Promise<void> => {
    const picker = pickDirectoryIfPossible();
    if (picker === null) {
      openFallback();
      return;
    }
    await grant();
  }, [openFallback]); // grant se definirá abajo, o grant se usa aquí

  const grant = useCallback(async (): Promise<void> => {
    const picker = pickDirectoryIfPossible();
    if (picker === null) {
      openFallback();
      return;
    }
    setState((prev) => ({ ...prev, status: "granting", error: null }));
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await picker.call(window, { mode: "read" });
    } catch (error) {
      if (isAbortError(error)) {
        // El jugador cerró el selector: no es un error, volvemos a pedir permiso.
        setState((prev) => ({ ...prev, status: "idle" }));
        return;
      }
      setState((prev) => ({
        ...prev,
        status: "error",
        error: `No se pudo abrir la carpeta: ${errorMessage(error)}`,
      }));
      return;
    }
    setState((prev) => ({ ...prev, status: "reading" }));
    try {
      await storeDirHandle(dir);
    } catch {
      // Persistencia es best-effort: seguimos leyendo aunque IndexedDB falle.
    }
    try {
      selectFrom(await readAllMedia(dir, optsRef.current.mode));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        status: "error",
        error: `No se pudo leer la carpeta: ${errorMessage(error)}`,
      }));
    }
  }, [openFallback, selectFrom]);

  const ingest = useCallback(
    (files: File[], merge = false): void => {
      const wanted = files
        .filter((file) => isWantedMedia(file, optsRef.current.mode))
        .slice(0, MAX_LIBRARY_FILES);

      if (merge) {
        setState((prev) => {
          const combined = [...prev.allFiles, ...wanted];
          const uniqueMap = new Map<string, File>();
          for (const f of combined) {
            uniqueMap.set(fileKey(f), f);
          }
          const unique = Array.from(uniqueMap.values());
          const target = optsRef.current.size;
          if (unique.length < target) {
            return {
              status: "error",
              error: notEnoughMessage(target, unique.length),
              selected: [],
              allFiles: unique,
            };
          }
          return {
            status: "ready",
            error: null,
            allFiles: unique,
            selected: sampleRandom(unique, target),
          };
        });
        return;
      }

      selectFrom(wanted);
    },
    [selectFrom],
  );

  const rerollAll = useCallback((): void => {
    setState((prev) => {
      const wanted = optsRef.current.size;
      if (prev.allFiles.length < wanted) {
        return {
          ...prev,
          status: "error",
          error: notEnoughMessage(wanted, prev.allFiles.length),
          selected: [],
        };
      }
      return {
        ...prev,
        status: "ready",
        error: null,
        selected: sampleRandom(prev.allFiles, wanted),
      };
    });
  }, []);

  const rerollOne = useCallback((index: number): void => {
    setState((prev) => {
      const current = prev.selected[index];
      if (current === undefined || prev.allFiles.length === 0) return prev;
      const key = fileKey(current);
      const alternatives = prev.allFiles.filter((file) => fileKey(file) !== key);
      const source = alternatives.length > 0 ? alternatives : prev.allFiles;
      const next = source[Math.floor(Math.random() * source.length)];
      if (next === undefined) return prev;
      const selected = [...prev.selected];
      selected[index] = next;
      return { ...prev, selected };
    });
  }, []);

  const reset = useCallback((): void => setState(INITIAL_STATE), []);

  // Al montar, recupera el handle guardado: si el permiso sigue concedido,
  // releemos la biblioteca y entramos directo a "ready".
  useEffect(() => {
    if (pickDirectoryIfPossible() === null) return;
    let cancelled = false;
    const restore = async (): Promise<void> => {
      const stored = await readStoredDirHandle();
      if (stored === null || cancelled) return;
      if ((await readPermission(stored)) !== "granted") return;
      if (cancelled) return;
      setState((prev) => ({ ...prev, status: "reading", error: null }));
      try {
        const files = await readAllMedia(stored, optsRef.current.mode);
        if (cancelled) return;
        selectFrom(files);
      } catch (error) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          status: "error",
          error: `No se pudo leer la carpeta: ${errorMessage(error)}`,
        }));
      }
    };
    restore().catch(() => {
      // Sin IndexedDB o handle corrupto: se vuelve a pedir permiso.
    });
    return () => {
      cancelled = true;
    };
  }, [selectFrom]);

  return {
    status: state.status,
    error: state.error,
    selected: state.selected,
    allFiles: state.allFiles,
    grant,
    openFilesPicker,
    openFolderPicker,
    rerollAll,
    rerollOne,
    ingest,
    reset,
    fallbackRef,
  };
}
