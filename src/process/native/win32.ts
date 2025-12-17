// From https://github.com/OpenAsar/arrpc/pull/109

import koffi from "koffi";
import type { ProcessEntry } from "../../types.ts";

// Load Windows API
// EnumProcesses is in K32 on newer windows, but PSAPI is safer for compat.
const psapi = koffi.load("psapi.dll");
const ntdll = koffi.load("ntdll.dll");

const HANDLE = koffi.pointer("HANDLE", koffi.opaque());

// FIX: Define struct correctly with types that allow reading length
const UNICODE_STRING = koffi.struct("UNICODE_STRING", {
	Length: "uint16",
	MaximumLength: "uint16",
	Buffer: koffi.pointer("Buffer", "char"), // Treat as char* for buffer access
});

const _SYSTEM_PROCESS_ID_INFORMATION = koffi.struct(
	"SYSTEM_PROCESS_ID_INFORMATION",
	{
		ProcessId: HANDLE,
		ImageName: UNICODE_STRING,
	},
);

const EnumProcesses = psapi.func(
	"BOOL __stdcall EnumProcesses(_Out_ DWORD *lpidProcess, DWORD cb, _Out_ DWORD *lpcbNeeded)",
);

const NtQuerySystemInformation = ntdll.func(
	"NtQuerySystemInformation",
	"int32",
	["int32", _SYSTEM_PROCESS_ID_INFORMATION, "uint32", HANDLE],
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
			24, // Size of structure roughly
			null,
		);

		if (NT_ERROR(result) && result !== STATUS_INFO_LENGTH_MISMATCH) {
			return null;
		}

		if (NT_SUCCESS(result)) {
			const lengthBytes = info.ImageName.Length;
			return buffer.subarray(0, lengthBytes).toString("utf16le");
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
				const cleanName = rawName.trim();
				if (cleanName) {
					out.push([pid, cleanName, [], undefined]);
				}
			}
		}
	}
	return out;
};