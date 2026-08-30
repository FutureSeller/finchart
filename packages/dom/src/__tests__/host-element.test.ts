/**
 * If `container` isn't a DOM element, both entry points must refuse it — a
 * selector string is a common mistake since other chart libraries accept
 * one.
 *
 * Each throws in its own vocabulary: `build` throws `ContractError` because
 * the caller misused the API; `createDomLayers` throws `RenderError`
 * because the wiring itself is wrong.
 */
import { ContractError, RenderError } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { PlotBuilder } from "../builder";
import { createDomLayers } from "../dom-layers";
import { fakeContainer, fakeLayersFactory, testBrowserDeps } from "./fakes";

/** Truthy values that aren't elements — every one of these passes as truthy today. */
const NOT_ELEMENTS: [string, unknown][] = [
  ["a selector string", "#chart"],
  ["an empty object", {}],
  ["a number", 1],
  ["an array", []],
];

describe("the stage's host must be an element", () => {
  for (const [name, value] of NOT_ELEMENTS) {
    it(`build(${name}) rejects it in our own vocabulary`, () => {
      const deps = {
        ...testBrowserDeps(),
        createLayers: fakeLayersFactory().createLayers,
      };
      const builder = PlotBuilder.create(deps, undefined);

      // The type system blocks this value — the victim is a consumer not using TypeScript.
      expect(() => builder.build(value as never)).toThrow(ContractError);
      expect(() => builder.build(value as never)).toThrow(/build\(container\)/);
    });
  }

  it("tells someone who passed a selector what to do next", () => {
    const deps = {
      ...testBrowserDeps(),
      createLayers: fakeLayersFactory().createLayers,
    };

    expect(() => PlotBuilder.create(deps).build("#chart" as never)).toThrow(
      /querySelector/,
    );
  });

  it("createDomLayers rejects it in wiring vocabulary", () => {
    expect(() => createDomLayers("#chart" as never, 800, 600)).toThrow(
      RenderError,
    );
  });

  it("control group: a real element stands up fine", () => {
    const deps = {
      ...testBrowserDeps(),
      createLayers: fakeLayersFactory().createLayers,
    };

    expect(() => PlotBuilder.create(deps).build(fakeContainer())).not.toThrow();
  });
});
