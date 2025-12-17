// From https://github.com/OpenAsar/arrpc/pull/109

import koffi from "koffi";
import type { ProcessEntry } from "../../types.ts";

// Load Windows API
const psapi = koffi.load("psapi.dll");
// const kernel32 = koffi.load("kernel32.dll");
const ntdll = koffi.load("ntdll.dll");

// Define Alias
// const _DWORD = koffi.alias("DWORD", "uint32_t");
// const _BOOL = koffi.alias("BOOL", "int32_t");
const HANDLE = koffi.pointer("HANDLE", koffi.opaque());

// const UNICODE_STRING = koffi.struct("UNICODE_STRING", {
// 	Length: "uint16",
// 	MaximumLength: "uint16",
// 	Buffer: HANDLE,
// });

// const _SYSTEM_PROCESS_ID_INFORMATION = koffi.struct(
// 	"SYSTEM_PROCESS_ID_INFORMATION",
// 	{
// 		ProcessId: HANDLE,
// 		ImageName: UNICODE_STRING,
// 	},
// );

const EnumProcesses = psapi.func(
	"BOOL __stdcall EnumProcesses(_Out_ DWORD *lpidProcess, DWORD cb, _Out_ DWORD *lpcbNeeded)",
);
// const _GetLastError = kernel32.func("DWORD GetLastError()");
const NtQuerySystemInformation = ntdll.func(
	"NtQuerySystemInformation",
	"int32",
	["int32", "SYSTEM_PROCESS_ID_INFORMATION*", "uint32", HANDLE],
);

const SystemProcessIdInformation = 88;
const STATUS_INFO_LENGTH_MISMATCH = 0xc0000004;
const NT_SUCCESS = (status: number) => status >= 0;
const NT_ERROR = (status: number) => status < 0;

const getProcessImageName = (pid: number): string | null => {
	let bufferSize = 1024;
	let buffer = Buffer.alloc(bufferSize);

	while (true) {
		const info = {
			ProcessId: pid,
			ImageName: {
				Length: 0,
				MaximumLength: buffer.length,
				Buffer: buffer,
			},
		};

		const result = NtQuerySystemInformation(
			SystemProcessIdInformation,
			info,
			24,
			null,
		);

		if (NT_ERROR(result) && result !== STATUS_INFO_LENGTH_MISMATCH) {
			return null;
		}

		if (NT_SUCCESS(result)) {
			return buffer.subarray(0, buffer.length).toString("utf16le");
		}

		if (bufferSize >= 0xffff) {
			return null;
		}

		bufferSize *= 2;
		if (bufferSize > 0xffff) bufferSize = 0xffff;
		buffer = Buffer.alloc(bufferSize);
	}
};

export const getProcesses = async (): Promise<ProcessEntry[]> => {
	const PROCESS_CAPACITY = 4096;
	const processIds = new Uint32Array(PROCESS_CAPACITY);
	const bytesNeeded = new Uint32Array(1);
	const out: ProcessEntry[] = [];

	const success = EnumProcesses(processIds, processIds.byteLength, bytesNeeded);

	if (!success) {
		return [];
	}

	if (bytesNeeded[0] === undefined) return [];
	const numProcesses = bytesNeeded[0] / 4;
	for (let i = 0; i < numProcesses; ++i) {
		const pid = processIds[i];
		if (pid) {
			const rawName = getProcessImageName(pid);
			if (rawName !== null) {
				const cleanName = rawName.split("\x00")[0]?.trim();
				if (cleanName) {
					out.push([pid, cleanName, [], undefined]);
				}
			}
		}
	}
	return out;
};