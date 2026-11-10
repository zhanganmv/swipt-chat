// Minimal incremental UTF-8 decoder: Hermes has no TextDecoder in every build,
// and SSE chunks may split a multi-byte code point across reads.
export class UTF8Decoder {
  private pending: number[] = [];

  decode(bytes: Uint8Array): string {
    const all =
      this.pending.length === 0
        ? bytes
        : Uint8Array.from([...this.pending, ...bytes]);
    this.pending = [];

    let out = "";
    let i = 0;
    while (i < all.length) {
      const byte = all[i];
      if (byte < 0x80) {
        out += String.fromCharCode(byte);
        i += 1;
        continue;
      }

      let need = 0;
      let code = 0;
      if ((byte & 0xe0) === 0xc0) {
        need = 1;
        code = byte & 0x1f;
      } else if ((byte & 0xf0) === 0xe0) {
        need = 2;
        code = byte & 0x0f;
      } else if ((byte & 0xf8) === 0xf0) {
        need = 3;
        code = byte & 0x07;
      } else {
        // Invalid leading byte: skip it rather than poisoning the stream.
        i += 1;
        continue;
      }

      if (i + need >= all.length) {
        this.pending = Array.from(all.slice(i));
        break;
      }

      let valid = true;
      for (let k = 1; k <= need; k += 1) {
        const next = all[i + k];
        if ((next & 0xc0) !== 0x80) {
          valid = false;
          break;
        }
        code = (code << 6) | (next & 0x3f);
      }
      if (!valid) {
        i += 1;
        continue;
      }

      out += String.fromCodePoint(code);
      i += need + 1;
    }
    return out;
  }
}