import { describe, expect, it } from "vitest";
import { forEachStill, mapStill } from "../still";

describe("forEachStill", () => {
  it("still visits the next item when a visit removes the current one", () => {
    const list = ["a", "b", "c"];
    const seen: string[] = [];
    forEachStill(list, (item) => {
      seen.push(item);
      if (item === "a") list.splice(list.indexOf("a"), 1);
    });
    expect(seen).toEqual(["a", "b", "c"]);
  });

  it("skips an item removed before its turn", () => {
    const list = ["a", "b", "c"];
    const seen: string[] = [];
    forEachStill(list, (item) => {
      seen.push(item);
      if (item === "a") list.splice(list.indexOf("b"), 1);
    });
    expect(seen).toEqual(["a", "c"]);
  });

  it("leaves an item added mid-walk for the next walk", () => {
    const list = ["a"];
    const seen: string[] = [];
    forEachStill(list, (item) => {
      seen.push(item);
      list.push("late");
    });
    expect(seen).toEqual(["a"]);
  });
});

describe("mapStill", () => {
  it("collects what each still-present item returns, in order", () => {
    const list = [1, 2, 3];
    expect(mapStill(list, (n) => {
      if (n === 1) list.splice(0, 1);
      return n * 10;
    })).toEqual([10, 20, 30]);
  });
});
