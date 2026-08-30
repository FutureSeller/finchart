import { describe, expect, it } from "vitest";
import { createScope } from "../scope";

describe("dispose order", () => {
  it("should run disposers in reverse registration order", () => {
    const order: string[] = [];
    const scope = createScope();
    scope.add(() => order.push("first"));
    scope.add(() => order.push("second"));
    scope.add(() => order.push("third"));

    scope.dispose();

    expect(order).toEqual(["third", "second", "first"]);
  });

  it("should dispose a child before the parent's own earlier disposers", () => {
    const order: string[] = [];
    const scope = createScope();
    scope.add(() => order.push("parent"));
    const child = scope.child();
    child.add(() => order.push("child"));

    scope.dispose();

    expect(order).toEqual(["child", "parent"]);
  });
});

describe("idempotence", () => {
  it("should run each disposer exactly once across repeated dispose calls", () => {
    let runs = 0;
    const scope = createScope();
    scope.add(() => {
      runs += 1;
    });

    scope.dispose();
    scope.dispose();

    expect(runs).toBe(1);
    expect(scope.disposed).toBe(true);
  });

  it("should not re-run an early-disposed child when the parent disposes", () => {
    let runs = 0;
    const scope = createScope();
    const child = scope.child();
    child.add(() => {
      runs += 1;
    });

    child.dispose();
    scope.dispose();

    expect(runs).toBe(1);
  });
});

describe("a closed scope", () => {
  it("should run a late disposer immediately instead of holding it forever", () => {
    const scope = createScope();
    scope.dispose();

    let ran = false;
    scope.add(() => {
      ran = true;
    });

    expect(ran).toBe(true);
  });

  it("should hand out children that are already closed", () => {
    const scope = createScope();
    scope.dispose();

    const child = scope.child();
    let ran = false;
    child.add(() => {
      ran = true;
    });

    expect(child.disposed).toBe(true);
    expect(ran).toBe(true);
  });

  it("should run a disposer added by another disposer mid-dispose", () => {
    const order: string[] = [];
    const scope = createScope();
    scope.add(() => {
      order.push("outer");
      scope.add(() => order.push("inner"));
    });

    scope.dispose();

    expect(order).toEqual(["outer", "inner"]);
  });
});

describe("failures", () => {
  it("should keep going when one disposer throws, then rethrow it unwrapped", () => {
    const order: string[] = [];
    const boom = new Error("boom");
    const scope = createScope();
    scope.add(() => order.push("survivor"));
    scope.add(() => {
      throw boom;
    });

    expect(() => scope.dispose()).toThrow(boom);
    expect(order).toEqual(["survivor"]);
  });

  it("should collect multiple failures into one AggregateError", () => {
    const first = new Error("first");
    const second = new Error("second");
    const scope = createScope();
    scope.add(() => {
      throw first;
    });
    scope.add(() => {
      throw second;
    });

    let caught: unknown;
    try {
      scope.dispose();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    if (caught instanceof AggregateError) {
      // LIFO: the later registration throws first.
      expect(caught.errors).toEqual([second, first]);
    }
  });

  it("should stay disposed after a throwing dispose", () => {
    const scope = createScope();
    scope.add(() => {
      throw new Error("boom");
    });

    expect(() => scope.dispose()).toThrow();
    expect(scope.disposed).toBe(true);
    expect(() => scope.dispose()).not.toThrow();
  });
});
