import postcss from "postcss";
import cssModules from "postcss-modules";
import path from "path";
import * as fse from "fs-extra";
import type * as esbuild from "esbuild";

import type { RemixConfig } from "../../config";

export function cssModulesServerPlugin(
  config: RemixConfig,
  suffixMatcher: RegExp
): esbuild.Plugin {
  return {
    name: "css-modules-imports-server",
    async setup(build) {
      build.onResolve({ filter: suffixMatcher }, args => {
        return {
          path: path.resolve(args.resolveDir, args.path),
          namespace: "css-modules-import"
        };
      });

      build.onLoad({ filter: suffixMatcher }, async args => {
        let json: { [name: string]: string } = {};
        let css = await fse.readFile(args.path, "utf-8");

        // TODO: Cache result
        let result = await postcss([
          cssModules({
            localsConvention: "camelCase",
            generateScopedName: "[name]__[local]___[hash:base64:5]",
            hashPrefix: "remix",
            getJSON(_, data) {
              json = { ...data };
              return json;
            }
          })
        ]).process(css, { from: undefined, map: false });
        return {
          contents: JSON.stringify(json),
          loader: "json"
        };
      });
    }
  };
}
