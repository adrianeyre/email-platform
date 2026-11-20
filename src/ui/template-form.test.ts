import { describe, expect, it } from "vitest";
import {
  blankTemplateForm,
  buildTemplateBody,
  changeName,
  changeSlug,
  findFormSlugProblem,
  findMissingSamples,
  parseSampleVariables,
  readTemplateForm,
  splitVariableNames,
} from "./template-form.js";

describe("template form", () => {
  it("splits a comma-separated variable list and drops blanks", () => {
    expect(splitVariableNames(" name, orderId ,, ")).toEqual([
      "name",
      "orderId",
    ]);
  });

  it("parses sample variables and explains bad JSON", () => {
    expect(parseSampleVariables('{"name":"Ada"}')).toEqual({
      isValid: true,
      values: { name: "Ada" },
    });
    expect(parseSampleVariables("")).toEqual({ isValid: true, values: {} });
    expect(parseSampleVariables("[1]")).toEqual({
      isValid: false,
      message: "Sample variables must be a JSON object",
    });
    expect(parseSampleVariables("{").isValid).toBe(false);
  });

  it("lists required variables that have no sample value", () => {
    expect(findMissingSamples("name, orderId", { name: "Ada" })).toEqual([
      "orderId",
    ]);
  });

  it("round-trips a saved template through the form", () => {
    const form = readTemplateForm({
      name: "Welcome",
      slug: "welcome",
      subject: "Hi {{name}}",
      html: "<p>Hi</p>",
      text: null,
      variables: ["name"],
      sampleVariables: { name: "Ada" },
    });
    expect(buildTemplateBody(form, { name: "Ada" })).toEqual({
      name: "Welcome",
      slug: "welcome",
      subject: "Hi {{name}}",
      html: "<p>Hi</p>",
      text: null,
      variables: ["name"],
      sampleVariables: { name: "Ada" },
      design: null,
      headerId: null,
      footerId: null,
      configurationId: null,
    });
  });

  it("has a new template's slug follow its name until the slug is edited", () => {
    let form = { ...blankTemplateForm };
    form = { ...form, ...changeName(form, "Order Shipped!") };
    expect(form.slug).toBe("order-shipped");
    expect(findFormSlugProblem(form)).toBeUndefined();
    expect(buildTemplateBody(form, {})).not.toHaveProperty("slug");

    form = { ...form, ...changeSlug("Shipped-Order") };
    expect(form.slug).toBe("shipped-order");
    form = { ...form, ...changeName(form, "Something else") };
    expect(form.slug).toBe("shipped-order");
    expect(buildTemplateBody(form, {})).toMatchObject({
      slug: "shipped-order",
    });
  });

  it("explains a slug that breaks the rule once it is the user's own", () => {
    const form = { ...blankTemplateForm, ...changeSlug("order shipped") };
    expect(findFormSlugProblem(form)).toMatch(
      /lowercase letters, numbers and hyphens/u,
    );
    expect(
      findFormSlugProblem({ ...blankTemplateForm, ...changeSlug("") }),
    ).toBe("Enter a slug");
  });
});
