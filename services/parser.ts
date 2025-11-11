import type { ParsedSmppData, SmppTlv, PacketSummary } from '../types';
import { COMMAND_ID_MAP, DATA_CODING_MAP, ESM_CLASS_MAP } from '../constants';

// --- DECODING HELPERS ---

function decodeMessage(messageBuffer: Uint8Array, dataCoding: number): string {
    const scheme = DATA_CODING_MAP[dataCoding] || `Unknown (0x${dataCoding.toString(16)})`;
    let content = '';

    try {
        switch (dataCoding) {
            case 0x08: // UCS-2
                content = new TextDecoder('utf-16be').decode(messageBuffer);
                break;
            case 0x03: // Latin-1
                content = new TextDecoder('iso-8859-1').decode(messageBuffer);
                break;
            case 0x04: // UTF-8, as requested
                content = new TextDecoder('utf-8').decode(messageBuffer);
                break;
            case 0x00: // GSM 7-bit (simple implementation for display)
                 content = `[GSM 7-bit encoded data: ${bufferToHex(messageBuffer)}]`;
                break;
            default: // Binary or unknown
                content = `[Binary Data: ${bufferToHex(messageBuffer)}]`;
        }
    } catch (e) {
        content = `[Error decoding: ${(e as Error).message}]`;
    }

    return `(${scheme}) ${content}`;
}

function bufferToHex(buffer: Uint8Array): string {
    return Array.from(buffer).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

// --- SMPP-M PDU PARSING ---

class BufferReader {
    private view: DataView;
    private textDecoder = new TextDecoder('ascii');
    public offset: number;

    constructor(buffer: ArrayBuffer) {
        this.view = new DataView(buffer);
        this.offset = 0;
    }
    
    peekUint32(offset: number): number | null {
        if (offset + 4 > this.view.byteLength) {
            return null;
        }
        return this.view.getUint32(offset, false);
    }

    readUint32(): number {
        const value = this.view.getUint32(this.offset, false); // Big Endian
        this.offset += 4;
        return value;
    }

    readUint8(): number {
        const value = this.view.getUint8(this.offset);
        this.offset += 1;
        return value;
    }

    readCString(): string {
        const start = this.offset;
        while (this.offset < this.view.byteLength && this.view.getUint8(this.offset) !== 0) {
            this.offset++;
        }
        const str = this.textDecoder.decode(new Uint8Array(this.view.buffer, start, this.offset - start));
        if (this.offset < this.view.byteLength) {
            this.offset++; // Skip null terminator
        }
        return str;
    }

    readBytes(length: number): Uint8Array {
        const value = new Uint8Array(this.view.buffer, this.offset, length);
        this.offset += length;
        return value;
    }
    
    readTlv(): SmppTlv | null {
        if (this.bytesRemaining() < 4) {
            return null;
        }

        const tag = this.view.getUint16(this.offset, false);
        const length = this.view.getUint16(this.offset + 2, false);

        // Safety check: ensure the TLV's length doesn't exceed the remaining buffer.
        if (length > (this.bytesRemaining() - 4)) {
            // Malformed TLV, stop parsing further TLVs.
            return null;
        }
        
        this.offset += 4; // Move past tag and length.
        const value = this.readBytes(length);
        
        return { tag, length, value: bufferToHex(value) };
    }

    bytesRemaining(): number {
        return this.view.byteLength - this.offset;
    }
}

function parseDeliverSmBody(reader: BufferReader, smppLength: number): Record<string, any> {
    const body: Record<string, any> = {};
    
    body.service_type = reader.readCString();
    body.source_addr_ton = reader.readUint8();
    body.source_addr_npi = reader.readUint8();
    body.source_address = reader.readCString();
    body.dest_addr_ton = reader.readUint8();
    body.dest_addr_npi = reader.readUint8();
    body.dest_address = reader.readCString();
    
    const esmClass = reader.readUint8();
    body.esm_class = `${ESM_CLASS_MAP(esmClass)} (0x${esmClass.toString(16).padStart(2, '0')})`;

    body.protocol_id = reader.readUint8();
    body.priority_flag = reader.readUint8();
    body.replace_if_present_flag = reader.readUint8(); // This field is not in the doc but standard in SMPP
    
    const data_coding = reader.readUint8();
    body.data_coding = data_coding;
    
    body.sm_default_msg_id = reader.readUint8();
    
    const sm_length = reader.readUint8();
    body.sm_length = sm_length;

    let message_content: Uint8Array | null = null;
    if (sm_length > 0 && sm_length <= reader.bytesRemaining()) {
        message_content = reader.readBytes(sm_length);
        body.short_message = bufferToHex(message_content);
    }
    
    // Parse TLVs
    const tlvs: SmppTlv[] = [];
    while (reader.bytesRemaining() > 0) {
        const tlv = reader.readTlv();
        if (tlv) {
            tlvs.push(tlv);
            // Check for message_payload TLV
            if (tlv.tag === 0x0424) { // message_payload
                message_content = new Uint8Array((tlv.value as string).split(' ').map(s => parseInt(s, 16)));
            }
        } else {
            break; // Stop if we can't read a valid TLV
        }
    }

    if (tlvs.length > 0) {
        body.tlvs = tlvs.map(t => ({
            tag: `0x${t.tag.toString(16).padStart(4, '0')}`,
            length: t.length,
            value: t.value,
        }));
    }

    if (message_content) {
        body.decoded_message = decodeMessage(message_content, data_coding);
    } else {
        body.decoded_message = "(No message content)";
    }
    
    return body;
}


function parseSmppPdu(pduBuffer: ArrayBuffer): ParsedSmppData {
    const reader = new BufferReader(pduBuffer);

    const header = {
        command_length: reader.readUint32(),
        command_id: reader.readUint32(),
        command_status: reader.readUint32(),
        sequence_no: reader.readUint32(),
    };
    
    if (header.command_length !== pduBuffer.byteLength) {
      console.warn(`SMPP command_length mismatch: header says ${header.command_length}, but buffer size is ${pduBuffer.byteLength}. Parsing continues.`);
    }

    const commandName = COMMAND_ID_MAP[header.command_id] || 'Unknown Command';

    let body = {};
    if (commandName === 'deliver_sm') {
        body = parseDeliverSmBody(reader, header.command_length);
    } else {
        const remainingBytes = reader.bytesRemaining();
        body = {
            unsupported_command: `Parser for ${commandName} (0x${header.command_id.toString(16)}) is not implemented.`,
            raw_body: remainingBytes > 0 ? bufferToHex(reader.readBytes(remainingBytes)) : "No body"
        };
    }

    return {
        header: {
            ...header,
            command_name: commandName,
        },
        body,
    };
}

export function parseMultipleSmppPdus(tcpPayload: ArrayBuffer): ParsedSmppData[] {
    const allPdus: ParsedSmppData[] = [];
    let offset = 0;
    const view = new DataView(tcpPayload);
    const knownCommandIds = Object.keys(COMMAND_ID_MAP).map(Number);

    // Scan through the buffer to find valid PDUs, robust against stream fragments
    while (offset + 16 <= view.byteLength) { // While there's enough space for at least a header
        const commandId = view.getUint32(offset + 4, false); // Peek at command_id

        // Heuristic: Check if the command ID is one we recognize
        if (knownCommandIds.includes(commandId)) {
            const commandLength = view.getUint32(offset, false); // Peek at command_length

            // Heuristic: Check if the length is reasonable
            if (commandLength >= 16 && (offset + commandLength) <= view.byteLength) {
                // If both heuristics pass, we likely found a valid PDU.
                const singlePduBuffer = tcpPayload.slice(offset, offset + commandLength);
                try {
                    const parsedPdu = parseSmppPdu(singlePduBuffer);
                    allPdus.push(parsedPdu);
                    
                    // Advance the offset by the length of the PDU we just parsed
                    offset += commandLength;
                    continue; // Restart the loop from the new offset
                } catch (e) {
                    console.error("Error parsing a PDU slice, attempting to recover by advancing.", e);
                    // If parsing fails despite heuristics, advance by one to avoid an infinite loop
                    offset++; 
                    continue;
                }
            }
        }
        
        // If we didn't find a valid PDU starting at this offset, advance by one byte and try again.
        // This effectively skips over any prepended garbage or stream fragments.
        offset++;
    }

    return allPdus;
}


// --- PCAP PARSING ---

export function parsePcapFile(file: File): Promise<PacketSummary[]> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const buffer = e.target?.result as ArrayBuffer;
            if (!buffer) {
                return reject(new Error('Failed to read file buffer.'));
            }
            try {
                const packets = extractAllTcpPayloads(buffer);
                resolve(packets);
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(new Error('Error reading the file.'));
        reader.readAsArrayBuffer(file);
    });
}

function extractAllTcpPayloads(pcapBuffer: ArrayBuffer): PacketSummary[] {
    const packets: PacketSummary[] = [];
    const view = new DataView(pcapBuffer);
    
    if (view.byteLength < 24) throw new Error('Invalid PCAP file: too short for global header.');
    
    const magic_number = view.getUint32(0, false);
    let littleEndian: boolean;

    if (magic_number === 0xa1b2c3d4) {
        littleEndian = false;
    } else if (magic_number === 0xd4c3b2a1) {
        littleEndian = true;
    } else {
        throw new Error(`Unsupported or invalid PCAP file: magic number is incorrect (was 0x${magic_number.toString(16)}).`);
    }

    let offset = 24;
    let packetIndex = 0;

    while (offset < view.byteLength) {
        if (view.byteLength < offset + 16) break;
        
        const incl_len = view.getUint32(offset + 8, littleEndian);
        const packetStart = offset + 16;
        
        if (packetStart + incl_len > view.byteLength) break;

        // Simplified: Assuming Ethernet II -> IPv4 -> TCP
        // Skip Ethernet header (14 bytes)
        const ipHeaderOffset = packetStart + 14;
        
        if (ipHeaderOffset >= packetStart + incl_len) {
            offset += 16 + incl_len;
            continue;
        }

        const etherType = view.getUint16(packetStart + 12, false);
        if (etherType !== 0x0800) { // Not IPv4
            offset += 16 + incl_len;
            continue;
        }
        
        const ipHeaderLength = (view.getUint8(ipHeaderOffset) & 0x0F) * 4;
        const ipProtocol = view.getUint8(ipHeaderOffset + 9);
        
        if (ipProtocol !== 6) { // Not TCP
            offset += 16 + incl_len;
            continue;
        }

        const sourceIp = `${view.getUint8(ipHeaderOffset + 12)}.${view.getUint8(ipHeaderOffset + 13)}.${view.getUint8(ipHeaderOffset + 14)}.${view.getUint8(ipHeaderOffset + 15)}`;
        const destIp = `${view.getUint8(ipHeaderOffset + 16)}.${view.getUint8(ipHeaderOffset + 17)}.${view.getUint8(ipHeaderOffset + 18)}.${view.getUint8(ipHeaderOffset + 19)}`;

        const tcpHeaderOffset = ipHeaderOffset + ipHeaderLength;
        const sourcePort = view.getUint16(tcpHeaderOffset, false); // Big Endian
        const destPort = view.getUint16(tcpHeaderOffset + 2, false); // Big Endian
        
        const dataOffsetByte = view.getUint8(tcpHeaderOffset + 12);
        const tcpHeaderLength = ((dataOffsetByte & 0xF0) >> 4) * 4;
        
        const payloadOffset = tcpHeaderOffset + tcpHeaderLength;
        const totalHeaderLength = (payloadOffset - packetStart);
        const payloadLength = incl_len - totalHeaderLength;

        if (payloadLength > 16) { // Min SMPP header size
            packetIndex++;
            const payload = pcapBuffer.slice(payloadOffset, payloadOffset + payloadLength);
            
            // Quick peek at command_id for the info field
            const payloadReader = new BufferReader(payload);
            const cmdLen = payloadReader.peekUint32(0);
            const cmdId = payloadReader.peekUint32(4);
            let info = "SMPP Data";
            if(cmdId !== null && cmdLen !== null && cmdLen >= 16 && cmdLen <= payload.byteLength) {
                 info = COMMAND_ID_MAP[cmdId] || `Unknown Command (0x${cmdId.toString(16)})`;
                 if (cmdLen < payload.byteLength) {
                    info += ' (Multiple)';
                 }
            }

            packets.push({
                index: packetIndex,
                sourceIp,
                destIp,
                sourcePort,
                destPort,
                length: payloadLength,
                info,
                payload,
            });
        }
        
        offset += 16 + incl_len;
    }

    return packets;
}