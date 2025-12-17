import pc from "picocolors";

export class Logger {
	component?: string;
	color: string;

	constructor(component?: string, color: string = "blue") {
		this.component = component;
		this.color = color;
		this.log = this.log.bind(this);
	}

	log(...args: unknown[]): void {
		const colorFn = (pc as any)[this.color];
		const componentPart =
			this.component && typeof colorFn === "function"
				? ` > ${colorFn(this.component)}`
				: "";
		const prefix = `[${pc.blue("arRPC")}${componentPart}]`;
		console.log(prefix, ...args);
	}
}