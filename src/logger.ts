import pc from "picocolors";
import type { Formatter } from "picocolors/types";

type ColorName = keyof {
	[K in keyof typeof pc as typeof pc[K] extends Formatter ? K : never]: unknown;
};

export class Logger {
	component?: string;
	color: ColorName;

	constructor(component?: string, color: ColorName = "blue") {
		this.component = component;
		this.color = color;
	}

	log = (...args: unknown[]): void => {
		const colorFn = pc[this.color];
		const componentPart =
			this.component && typeof colorFn === "function"
				? ` > ${colorFn(this.component)}`
				: "";
		const prefix = `[${pc.blue("arRPC")}${componentPart}]`;
		console.log(prefix, ...args);
	};
}