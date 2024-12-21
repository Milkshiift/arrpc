/*
 * MIT License
 *
 * Copyright (c) 2016 Kevin Albertson
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
*/

const kString = 0
, kUint8Array = 1
, kIllegals = [
    0 // null
    , 10 // newline
    , 13 // carriage return
    , 34 // double quote
    , 38 // ampersand
    , 92 // backslash
]
, kShortened = 0b111 // Uses the illegal index to signify the last two-byte char encodes <= 7 bits.
;

/**
 * Encodes raw data into base-122.
 * @param {Uint8Array|Buffer|Array|String} rawData - The data to be encoded. This can be an array
 * or Buffer with raw data bytes or a string of bytes (i.e. the type of argument to btoa())
 * @returns {string} The base-122 encoded data as a regular array of UTF-8 character byte values.
 */
function encode(rawData) {
    let dataType = typeof(rawData) == 'string' ? kString : kUint8Array
    , curIndex = 0
    , curBit = 0 // Points to current bit needed
    , curMask = 0b10000000
    , outData = []
    , getByte = i => rawData[i]
    ;

    if (dataType == kString) {
        getByte = (i) => {
            let val = rawData.codePointAt(i);
            if (val > 255) {
                throw "Unexpected code point at position: " + i + ". Expected value [0,255]. Got: " + val;
            }
            return val;
        }
    }

    // Get seven bits of input data. Returns false if there is no input left.
    function get7() {
        if (curIndex >= rawData.length) return false;
        // Shift, mask, unshift to get first part.
        let firstByte = getByte(curIndex);
        let firstPart = ((0b11111110 >>> curBit) & firstByte) << curBit;
        // Align it to a seven bit chunk.
        firstPart >>= 1;
        // Check if we need to go to the next byte for more bits.
        curBit += 7;
        if (curBit < 8) return firstPart; // Do not need next byte.
        curBit -= 8;
        curIndex++;
        // Now we want bits [0..curBit] of the next byte if it exists.
        if (curIndex >= rawData.length) return firstPart;
        let secondByte = getByte(curIndex);
        let secondPart = ((0xFF00 >>> curBit) & secondByte) & 0xFF;
        // Align it.
        secondPart >>= 8 - curBit;
        return firstPart | secondPart;
    }

    while(true) {
        // Grab 7 bits.
        let bits = get7();
        if (bits === false) break;

        let illegalIndex = kIllegals.indexOf(bits);
        if (illegalIndex != -1) {
            // Since this will be a two-byte character, get the next chunk of seven bits.
            let nextBits = get7();

            let b1 = 0b11000010, b2 = 0b10000000;
            if (nextBits === false) {
                b1 |= (0b111 & kShortened) << 2
                nextBits = bits; // Encode these bits after the shortened signifier.
            } else {
                b1 |= (0b111 & illegalIndex) << 2;
            }

            // Push first bit onto first byte, remaining 6 onto second.
            let firstBit = (nextBits & 0b01000000) > 0 ? 1 : 0;
            b1 |= firstBit;
            b2 |= nextBits & 0b00111111;
            outData.push(b1);
            outData.push(b2);
        } else {
            outData.push(bits);
        }
    }
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(new Uint8Array(outData));
}

/**
 * Decodes base-122 encoded data back to the original data.
 * @param {Uint8Array|Buffer|String} rawData - The data to be decoded. This can be a Uint8Array
 * or Buffer with raw data bytes or a string of bytes (i.e. the type of argument to btoa())
 * @returns {Buffer} The data in a regular array representing byte values.
 */
function decode(base122Data) {
    let strData = typeof(base122Data) == 'string' ? base122Data : utf8DataToString(base122Data)
    , decoded = []
    , decodedIndex = 0
    , curByte = 0
    , bitOfByte = 0
    ;

    function push7(byte) {
        byte <<= 1;
        // Align this byte to offset for current byte.
        curByte |= (byte >>> bitOfByte);
        bitOfByte += 7;
        if (bitOfByte >= 8) {
            decoded.push(curByte);
            bitOfByte -= 8;
            // Now, take the remainder, left shift by what has been taken.
            curByte = (byte << (7 - bitOfByte)) & 255;
        }
    }

    for (let i = 0; i < strData.length; i++) {
        let c = strData.charCodeAt(i);
        // Check if this is a two-byte character.
        if (c > 127) {
            // Note, the charCodeAt will give the codePoint, thus
            // 0b110xxxxx 0b10yyyyyy will give => xxxxxyyyyyy
            let illegalIndex = (c >>> 8) & 7; // 7 = 0b111.
            // We have to first check if this is a shortened two-byte character, i.e. if it only
            // encodes <= 7 bits.
            if (illegalIndex != kShortened) push7(kIllegals[illegalIndex]);
            // Always push the rest.
            push7(c & 127);
        } else {
            // One byte characters can be pushed directly.
            push7(c);
        }
    }
    return Buffer.from(decoded);
}


/**
 * Converts a sequence of UTF-8 bytes to a string.
 * @param {Uint8Array|Buffer} data - The UTF-8 data.
 * @returns {String} A string with each character representing a code point.
 */
function utf8DataToString(data) {
    return Buffer.from(data).toString('utf-8');
}

module.exports = {
    encode: encode,
    decode: decode
};