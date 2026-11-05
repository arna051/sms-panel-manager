export type ParameterBinding =
  | {
      readonly kind: "named";
      readonly providerParameter: string;
      readonly sourceParameter: string;
    }
  | {
      readonly kind: "ordered";
      readonly position: number;
      readonly sourceParameter: string;
    }
  | {
      readonly kind: "fixed-slot";
      readonly slot: string;
      readonly sourceParameter: string;
    };

export class InvalidParameterBindingError extends TypeError {
  readonly code = "template_binding_invalid";

  constructor(message: string) {
    super(message);
    this.name = "InvalidParameterBindingError";
  }
}

function assertSafeKey(value: string, label: string): void {
  if (
    value.length === 0 ||
    value === "__proto__" ||
    value === "prototype" ||
    value === "constructor"
  ) {
    throw new InvalidParameterBindingError(`Unsafe or empty ${label}.`);
  }
}

export function applyParameterBindings(
  parameters: Readonly<Record<string, unknown>>,
  bindings: readonly ParameterBinding[],
): Readonly<Record<string, unknown>> | readonly unknown[] {
  if (bindings.length === 0) {
    throw new InvalidParameterBindingError(
      "At least one parameter binding is required.",
    );
  }

  const kind = bindings[0]?.kind;
  if (bindings.some((binding) => binding.kind !== kind)) {
    throw new InvalidParameterBindingError(
      "Parameter binding kinds cannot be mixed.",
    );
  }

  const sources = new Set<string>();
  const destinations = new Set<string | number>();
  for (const binding of bindings) {
    assertSafeKey(binding.sourceParameter, "source parameter");
    if (sources.has(binding.sourceParameter)) {
      throw new InvalidParameterBindingError(
        `Source parameter "${binding.sourceParameter}" is mapped more than once.`,
      );
    }
    sources.add(binding.sourceParameter);

    const destination =
      binding.kind === "named"
        ? binding.providerParameter
        : binding.kind === "fixed-slot"
          ? binding.slot
          : binding.position;
    if (typeof destination === "string")
      assertSafeKey(destination, "destination");
    if (destinations.has(destination)) {
      throw new InvalidParameterBindingError(
        `Provider destination "${String(destination)}" is mapped more than once.`,
      );
    }
    destinations.add(destination);
  }

  if (Object.keys(parameters).some((parameter) => !sources.has(parameter))) {
    throw new InvalidParameterBindingError(
      "Every supplied action parameter must be mapped exactly once.",
    );
  }

  if (kind === "ordered") {
    const ordered = bindings
      .map((binding) => {
        if (binding.kind !== "ordered")
          throw new InvalidParameterBindingError("Invalid binding.");
        if (!Number.isSafeInteger(binding.position) || binding.position < 1) {
          throw new InvalidParameterBindingError(
            "Ordered positions must be positive integers.",
          );
        }
        return binding;
      })
      .sort((left, right) => left.position - right.position);
    if (ordered.some((binding, index) => binding.position !== index + 1)) {
      throw new InvalidParameterBindingError(
        "Ordered positions must be contiguous from one.",
      );
    }
    const values = ordered.map(
      (binding) => parameters[binding.sourceParameter],
    );
    while (values.at(-1) === undefined) values.pop();
    if (values.some((value) => value === undefined)) {
      throw new InvalidParameterBindingError(
        "An omitted ordered parameter cannot precede a supplied parameter.",
      );
    }
    return values;
  }

  const result: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const binding of bindings) {
    if (binding.kind === "ordered") {
      throw new InvalidParameterBindingError("Invalid ordered binding state.");
    }
    const destination =
      binding.kind === "named" ? binding.providerParameter : binding.slot;
    if (binding.sourceParameter in parameters) {
      result[destination] = parameters[binding.sourceParameter];
    }
  }
  return result;
}
