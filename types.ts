export interface SmppHeader {
  command_length: number;
  command_id: number;
  command_name: string;
  command_status: number;
  sequence_no: number;
}

export interface SmppTlv {
    tag: number | string;
    length: number;
    value: string; // Represented as hex string for generic display
}

export interface ParsedSmppData {
  header: SmppHeader;
  body: Record<string, any>;
}

export interface PacketSummary {
  index: number;
  sourceIp: string;
  destIp: string;
  sourcePort: number;
  destPort: number;
  length: number;
  info: string;
  payload: ArrayBuffer;
}
