import { ResolvedConfig, normalizePath } from "vite";
import { scanLayouts } from "./scan";
import { LayoutComponent, ResolvedOptions, UserOptions } from "./types";
import { logger, resolveOptions } from "./utils";
import { parse } from "@vue/compiler-dom";
import MagicString from "magic-string";
import { blue, red } from "colorette";
import { parse as JSONParse } from "jsonc-parser";
export class Context {
  options: ResolvedOptions;
  config!: ResolvedConfig;
  layouts!: LayoutComponent[];

  constructor(userOptions: UserOptions) {
    this.options = resolveOptions(userOptions);
  }

  async initLayouts() {
    this.layouts = await scanLayouts(this.options.layouts, this.config.root);
  }
  async virtualModule() {
    await this.initLayouts();
    logger.debug(`Generating virtual module`);
    const imports = this.layouts.map((v) => {
      return `import ${v.name} from "${normalizePath(v.path)}"`;
    });
    const components = this.layouts.map((v) => {
      return `app.component("${v.name}", ${v.name})`;
    });
    return `${imports.join("\n")}

export default {
  install(app) {
    ${components.join("\n")}
  }
}`;
  }

  generatorPageCode(code: string, id: string) {
    const t = parse(code);
    const source = new MagicString(code, {
      filename: id,
    });
    let layoutName: string | boolean = this.options.layouts.layout;
    let layoutProps: Record<string, any> = {};
    let templates: string[] = [];
    t?.children.forEach((v) => {
      if (v.type !== 1) {
        return;
      }
      if (v.tag === "layout") {
        // remove source layout block
        source.replace(v.loc.source, "");
        v.props.forEach((prop) => {
          if (prop.name === "name" && prop.type === 6) {
            layoutName = prop.value?.content ?? this.options.layouts.layout;
            logger.debug(`Page ${id} used ${blue(`${layoutName}`)} layout`);
          }
          if (prop.name === "disabled") {
            logger.debug(`Page ${id} ${red("disabled")} layout, ignore`);
            layoutName = false;
          }
        });
        const astProps = v.children?.[0];
        if (astProps && astProps.type === 2) {
          try {
            layoutProps = JSONParse(astProps.content);
          } catch (error) {
            logger.error(error);
          }
        }
      }
      if (v.tag === "template") {
        // remove source root template block
        source.replace(v.loc.source, "");
        if (v.props.find((v) => v.type === 7)) {
          templates.push(v.loc.source);
        } else {
          templates.push(
            v.loc.source.replace("<template", "<template #default")
          );
        }
      }
    });
    if (!layoutName) {
      return false;
    }
    const layout = this.layouts.find((l) => l.layout === layoutName);
    if (!layout) {
      logger.warn(`Can not find ${red(layoutName)} layout, ignore`);
      return false;
    }
    const props = Object.keys(layoutProps).map((key) => `${key}="${layoutProps[key]}"`)
    source.prepend(`<template>
<${layout.name} ref="layout" ${props.join(' ')} >
${templates.join("\n")}
</${layout.name}>
</template>`);
    const map = source.generateMap({
      source: id,
      file: `${id}.map`,
      includeContent: true,
    });
    return {
      code: source.toString(),
      map,
    };
  }
}
