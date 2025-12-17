import pc from "picocolors";

export class Logger {
	constructor(component = undefined, color = "blue") {
		this.component = component;
		this.color = color;
		this.log = this.log.bind(this);
	}

	log(...args) {
		const prefix = `[${pc.blue("arRPC")}${this.component ? ` > ${pc[this.color](this.component)}` : ""}]`;
		console.log(prefix, ...args);
	}
}
