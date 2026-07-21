import assert from "node:assert/strict";
import test from "node:test";
import { createSerialQueue } from "@/worker/lib/serial-queue";

test("enqueue runs operations serially", async () => {
  const queue = createSerialQueue("[test] serial");
  const order: number[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const first = queue.enqueue(async () => {
    order.push(1);
    await gate;
    order.push(2);
  });
  const second = queue.enqueue(async () => {
    order.push(3);
  });

  await Promise.resolve();
  assert.deepEqual(order, [1]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, [1, 2, 3]);
});

test("failed operation logs and does not block later enqueue", async () => {
  const queue = createSerialQueue("[test] failed");
  const errors: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  try {
    await queue.enqueue(async () => {
      throw new Error("boom");
    }).catch(() => undefined);
    await queue.wait();
    let ran = false;
    await queue.enqueue(async () => {
      ran = true;
    });
    assert.equal(ran, true);
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.[0], "[test] failed");
    assert.equal(errors[0]?.[1], "Error");
  } finally {
    console.error = original;
  }
});

test("independent queues do not share tails", async () => {
  const a = createSerialQueue("[a]");
  const b = createSerialQueue("[b]");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let bDone = false;
  void a.enqueue(async () => {
    await gate;
  });
  await b.enqueue(async () => {
    bDone = true;
  });
  assert.equal(bDone, true);
  release();
  await a.wait();
});
