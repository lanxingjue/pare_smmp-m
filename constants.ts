

export const COMMAND_ID_MAP: { [key: number]: string } = {
    0x00000001: 'bind_receiver',
    0x80000001: 'bind_receiver_resp',
    0x00000002: 'deliver_sm',
    0x80000002: 'deliver_sm_resp',
    0x00000003: 'unbind',
    0x80000003: 'unbind_resp',
    0x00000004: 'enquire_link',
    0x80000004: 'enquire_link_resp',
};

export const DATA_CODING_MAP: { [key: number]: string } = {
    0x00: 'Default (GSM 7-bit)',
    0x01: 'IA5 (ASCII)',
    0x02: '8-bit binary',
    0x03: 'Latin 1 (ISO-8859-1)',
    0x04: 'UTF-8',
    0x05: 'JIS',
    0x06: 'Cyrillic (ISO-8859-5)',
    0x07: 'Latin/Hebrew (ISO-8859-8)',
    0x08: 'UCS-2 (ISO/IEC-10646)',
    0x09: 'Pictogram Encoding',
    0x0A: 'ISO-2022-JP (Music Codes)',
    0x0D: 'Extended Kanji JIS',
    0x0E: 'KS C 5601',
};

export const ESM_CLASS_MAP = (value: number): string => {
    const messageMode = value & 0b00000011;
    const messageType = value & 0b00111100;
    
    let modeStr = '';
    switch(messageMode) {
        case 0b00: modeStr = 'Default Mode'; break;
        case 0b11: modeStr = 'Store and Forward'; break;
        default: modeStr = 'Unknown Mode';
    }

    let typeStr = '';
    switch(messageType) {
        case 0b00000000: typeStr = 'Default Message'; break;
        case 0b00000100: typeStr = 'Delivery Receipt'; break;
        case 0b00001000: typeStr = 'Delivery Acknowledgement'; break;
        case 0b01000000: typeStr = 'Manual/User Acknowledgement'; break;
        case 0b01100000: typeStr = 'Conversation Abort (Korean CDMA)'; break;
        case 0b10000000: typeStr = 'Intermediate Delivery Notification'; break;
        default: typeStr = 'Unknown Type';
    }

    return `${typeStr}, ${modeStr}`;
}