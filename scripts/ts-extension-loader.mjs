/**
 * Node 22 strips TypeScript syntax but does not resolve extensionless local
 * TypeScript imports. This tiny test-only loader mirrors the bundler's lookup.
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!specifier.startsWith(".") || !context.parentURL?.startsWith("file:")) {
      throw error;
    }
    for (const extension of [".ts", ".tsx", ".js", ".jsx"]) {
      try {
        return await nextResolve(specifier + extension, context);
      } catch {
        // Try the next supported source extension.
      }
    }
    try {
      return await nextResolve(specifier + "/index.ts", context);
    } catch {
      throw error;
    }
  }
}
