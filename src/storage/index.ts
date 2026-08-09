import { DexieStudyStorage } from './dexieStorage';
import { MemoryStudyStorage } from './memoryStorage';
import type { AppSettings, StudyStorage } from './types';

export * from './types';
export { migrateBackup, BackupFormatError, SCHEMA_VERSION } from './schema';
export { DexieStudyStorage } from './dexieStorage';
export { MemoryStudyStorage } from './memoryStorage';

let instance: StudyStorage | null = null;

/**
 * Opens the best available storage backend.
 *
 * IndexedDB is preferred; if it is missing or refuses to open (Safari private
 * mode, embedded webviews) we degrade to memory so the app still runs, and the
 * UI warns the user that nothing will be saved.
 */
export async function getStorage(): Promise<StudyStorage> {
  if (instance) return instance;
  const canUseIdb = typeof indexedDB !== 'undefined';
  if (canUseIdb) {
    try {
      const dexie = new DexieStudyStorage();
      await dexie.open();
      instance = dexie;
      return instance;
    } catch (error) {
      console.warn('[storage] IndexedDB를 열 수 없어 메모리 저장소로 전환합니다.', error);
    }
  }
  const memory = new MemoryStudyStorage();
  await memory.open();
  instance = memory;
  return instance;
}

/** Test hook — lets a test inject a storage double. */
export function __setStorageForTests(storage: StudyStorage | null): void {
  instance = storage;
}

export function defaultSettings(activeExamId: string): AppSettings {
  return {
    activeExamId,
    theme: 'system',
    dailyGoalOverride: null,
    confidencePromptEnabled: true,
    errorCausePromptEnabled: true,
    selectionSalt: Math.random().toString(36).slice(2, 10),
  };
}
