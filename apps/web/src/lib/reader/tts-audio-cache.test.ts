/**
 * Unit coverage for the client-side TTS audio cache (#150).
 *
 * The first attempt at this feature was reverted because it never produced a
 * hit and the failure could only be observed through Playwright, where the
 * stubbed response was itself a suspect (see #150). These tests pin the parts
 * that are pure logic or pure IndexedDB -- round-trip fidelity, key stability,
 * collision safety, eviction, and graceful degradation -- so the browser suite
 * only has to answer the one question it uniquely can: does a real second play
 * issue zero requests.
 *
 * fake-indexeddb provides a real IDB implementation over memory. It was
 * already a devDependency of apps/web and, until now, unused by anything.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import {
  __resetAudioCacheForTests,
  __settleAudioCacheForTests,
  cacheKey,
  clearAudioCache,
  readCachedAudio,
  writeCachedAudio,
} from "./tts-audio-cache";

const VOICE = "af_heart";
const SPEED = 1;

function audio(byte: number, length = 32): Blob {
  return new Blob([new Uint8Array(length).fill(byte)], { type: "audio/wav" });
}

async function bytesOf(blob: Blob): Promise<number[]> {
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

/**
 * jsdom's localStorage is shadowed here by Node 22's own built-in Web Storage,
 * which this runner starts without a backing file ("`--localstorage-file` was
 * provided without a valid path") and which is missing `clear`. Stubbing a
 * plain in-memory Storage is both simpler than configuring that away and
 * better isolation -- the budget override is the only thing these tests need
 * from it.
 */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

beforeEach(() => {
  // A fresh factory per test -- otherwise one test's records are another's
  // starting state, and the eviction test in particular depends on knowing
  // exactly what is in the store.
  globalThis.indexedDB = new IDBFactory();
  vi.stubGlobal("localStorage", memoryStorage());
  __resetAudioCacheForTests();
});

describe("cacheKey", () => {
  it("is stable across calls for the same tuple", () => {
    expect(cacheKey("hello there", VOICE, SPEED)).toBe(cacheKey("hello there", VOICE, SPEED));
  });

  it("separates voice, speed, and text", () => {
    const base = cacheKey("hello", VOICE, SPEED);
    expect(cacheKey("hello", "af_bella", SPEED)).not.toBe(base);
    expect(cacheKey("hello", VOICE, 1.5)).not.toBe(base);
    expect(cacheKey("hello!", VOICE, SPEED)).not.toBe(base);
  });

  it("cannot be confused by a delimiter inside a field", () => {
    // The pair that a naive `${voice}|${speed}|${text}` join would collide.
    expect(cacheKey("x", "af 1", SPEED)).not.toBe(cacheKey("1 x", "af", SPEED));
  });
});

describe("round trip", () => {
  it("returns the exact bytes that were written", async () => {
    const original = audio(7);
    await writeCachedAudio("chunk one", VOICE, SPEED, original);

    const hit = await readCachedAudio("chunk one", VOICE, SPEED);
    expect(hit).not.toBeNull();
    expect(await bytesOf(hit!)).toEqual(await bytesOf(original));
    expect(hit!.type).toBe("audio/wav");
  });

  it("misses on a cold cache", async () => {
    expect(await readCachedAudio("never stored", VOICE, SPEED)).toBeNull();
  });

  it("misses when the voice or speed differs", async () => {
    await writeCachedAudio("same text", VOICE, SPEED, audio(1));
    expect(await readCachedAudio("same text", "af_bella", SPEED)).toBeNull();
    expect(await readCachedAudio("same text", VOICE, 1.25)).toBeNull();
  });

  it("survives reopening the database", async () => {
    await writeCachedAudio("persisted", VOICE, SPEED, audio(3));
    // Drops the memoized handle without dropping the (in-memory) database --
    // the closest analogue to a page reload this runner can produce.
    __resetAudioCacheForTests();
    const hit = await readCachedAudio("persisted", VOICE, SPEED);
    expect(hit).not.toBeNull();
    expect(await bytesOf(hit!)).toEqual(await bytesOf(audio(3)));
  });
});

describe("collision safety", () => {
  it("treats a key whose stored text differs as a miss", async () => {
    await writeCachedAudio("real text", VOICE, SPEED, audio(9));

    // Forge the exact collision the hash cannot rule out: same key, different
    // source text. Serving these bytes would play the wrong audio, which is a
    // worse outcome than any cache miss.
    const key = cacheKey("real text", VOICE, SPEED);
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open("booklet-tts-audio");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("chunks", "readwrite");
      tx.objectStore("chunks").put({
        key,
        voice: VOICE,
        speed: SPEED,
        text: "a DIFFERENT string that hashed the same",
        bytes: new ArrayBuffer(8),
        type: "audio/wav",
        size: 8,
        lastUsedAt: Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    expect(await readCachedAudio("real text", VOICE, SPEED)).toBeNull();
  });
});

describe("eviction", () => {
  it("drops least-recently-used entries once over budget", async () => {
    // 300-byte budget against 100-byte chunks: the fourth write must push the
    // total to 400 and evict back down to at most 300.
    localStorage.setItem("booklet:tts-cache-budget", "300");

    for (const [i, text] of ["one", "two", "three"].entries()) {
      await writeCachedAudio(text, VOICE, SPEED, audio(i + 1, 100));
    }
    // Touch "one" so it is no longer the least-recently-used; "two" is. The
    // touch is fire-and-forget on the read path, so wait for it to commit --
    // otherwise this asserts against whatever order happened to win the race.
    expect(await readCachedAudio("one", VOICE, SPEED)).not.toBeNull();
    await __settleAudioCacheForTests();

    await writeCachedAudio("four", VOICE, SPEED, audio(4, 100));

    expect(await readCachedAudio("two", VOICE, SPEED)).toBeNull();
    expect(await readCachedAudio("four", VOICE, SPEED)).not.toBeNull();
  });

  it("keeps everything when under budget", async () => {
    await writeCachedAudio("small", VOICE, SPEED, audio(1, 10));
    expect(await readCachedAudio("small", VOICE, SPEED)).not.toBeNull();
  });
});

describe("graceful degradation", () => {
  it("reports a miss and never throws when IndexedDB cannot be opened", async () => {
    const open = vi.spyOn(indexedDB, "open").mockImplementation(() => {
      // Firefox private browsing throws synchronously rather than firing
      // onerror -- the shape this has to survive.
      throw new DOMException("A mutation operation was attempted on a database that did not allow mutations.");
    });

    await expect(readCachedAudio("anything", VOICE, SPEED)).resolves.toBeNull();
    // The write path must be equally silent -- playback already has its audio.
    await expect(writeCachedAudio("anything", VOICE, SPEED, audio(1))).resolves.toBeUndefined();

    open.mockRestore();
  });
});

describe("clearAudioCache", () => {
  it("discards everything", async () => {
    await writeCachedAudio("gone", VOICE, SPEED, audio(2));
    await clearAudioCache();
    expect(await readCachedAudio("gone", VOICE, SPEED)).toBeNull();
  });
});
