import postcss from "postcss";
import type { Result as PostCSSResult } from "postcss";
import cssModules from "postcss-modules";
import path from "path";
import * as fse from "fs-extra";
import type * as esbuild from "esbuild";

import { getFileHash } from "../utils/crypto";
import * as cache from "../../cache";
import type { RemixConfig } from "../../config";

type CSSModuleClassMap = { [key: string]: string };
type CachedCSSResult = {
  hash: string;
  result: PostCSSResult;
  json: CSSModuleClassMap;
};

const suffixMatcher = /\.module\.css?$/;

export function cssModulesServerPlugin(config: RemixConfig): esbuild.Plugin {
  return {
    name: "css-modules-imports-server",
    async setup(build) {
      build.onResolve({ filter: suffixMatcher }, args => {
        return {
          path: getResolvedFilePath(config, args),
          namespace: "css-modules-import-server"
        };
      });

      build.onLoad({ filter: suffixMatcher }, async args => {
        let { json } = await processCss(config, args.path);
        return {
          contents: JSON.stringify(json),
          loader: "json"
        };
      });
    }
  };
}

export function cssModulesClientPlugin(config: RemixConfig): esbuild.Plugin {
  return {
    name: "css-modules-imports-client",
    async setup(build) {
      build.onResolve({ filter: suffixMatcher }, args => {
        return {
          path: getResolvedFilePath(config, args),
          namespace: "css-modules-import-client"
        };
      });

      build.onLoad({ filter: suffixMatcher }, async args => {
        try {
          let { json, hash, result } = await processCss(config, args.path);
          let outDir = path.resolve(config.assetsBuildDirectory, "_assets");
          let assetName =
            path.basename(args.path).replace(suffixMatcher, "") +
            `-${hash}.css`;
          let assetPath = path.join(outDir, assetName);

          await fse.ensureDir(outDir);
          await fse.writeFile(assetPath, result.css, { encoding: "utf-8" });

          return {
            contents: JSON.stringify(json),
            loader: "json"
          };
        } catch (err: any) {
          return {
            errors: [{ text: err.message }]
          };
        }
      });
    }
  };
}

let cssPromiseCache = new Map<string, Promise<any>>();

async function processCss(
  config: RemixConfig,
  filePath: string
): Promise<CachedCSSResult> {
  // We are creating our own file hash since we're not relying on ESBuild to
  // write the file. I'm not sure what hashing algorithm they use but this
  // formats the filename in alignment with other assets. We can remove the
  // string manipulation and just use the full hash if it isn't important.
  let hash = (await getFileHash(filePath)).slice(0, 8).toUpperCase();

  if (cssPromiseCache.has(hash)) {
    return cssPromiseCache.get(hash);
  }

  let newPromise = (async function () {
    let cached: CachedCSSResult | null = null;
    let key = getCacheKey(config, filePath);
    let json: CSSModuleClassMap = {};
    try {
      cached = await cache.getJson(config.cacheDirectory, key);
    } catch (error) {}

    if (!cached || cached.hash !== hash) {
      let css = await fse.readFile(filePath, "utf-8");
      let result = await postcss([
        cssModules({
          localsConvention: "camelCase",
          generateScopedName: "[name]__[local]___[hash:base64:8]",
          hashPrefix: "remix",
          getJSON(_, data) {
            json = { ...data };
            return json;
          }
        })
      ]).process(css, { from: undefined, map: false });
      cached = { hash, json, result };

      try {
        await cache.putJson(config.cacheDirectory, key, cached);
      } catch (error) {}
    }
    return cached;
  })();
  cssPromiseCache.set(hash, newPromise);
  return newPromise;
}

function getCacheKey(config: RemixConfig, filePath: string) {
  return "css-module:" + path.relative(config.appDirectory, filePath);
}

function getResolvedFilePath(
  config: RemixConfig,
  args: { path: string; resolveDir: string }
) {
  // TODO: Ideally we should deal with the "~/" higher up in the build process
  // if possible.
  return args.path.startsWith("~/")
    ? path.resolve(config.appDirectory, args.path.replace(/^~\//, ""))
    : path.resolve(args.resolveDir, args.path);
}
