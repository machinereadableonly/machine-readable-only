// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";

import {Renderer} from "../src/render/Renderer.sol";
import {CodeRenderer} from "../src/render/CodeRenderer.sol";
import {FrameRenderer} from "../src/render/FrameRenderer.sol";
import {HeartMask} from "../src/render/HeartMask.sol";
import {TokenView} from "../src/render/TokenView.sol";
import {Base64} from "solady/src/utils/Base64.sol";
import {LibString} from "solady/src/utils/LibString.sol";

/// @notice WHERE the dearest token's gas actually goes.
///
/// @dev `RealTokenGas.t.sol` says the dearest token costs LARGEST_TOKEN_GAS
/// against a 4,000,000 hard limit (re-measured 2026-09-23), which is 11.5%
/// headroom -- the dearest and the largest are now one token. That
/// number says how much of the budget is spent; it does not say what spent it.
/// Nothing in the suite broke the total into parts, so every proposal to buy
/// headroom was guesswork.
///
/// This is a MEASUREMENT, not a gate. It asserts only that the parts do not
/// exceed the whole, because a profile whose parts outweigh the total is
/// measuring the harness rather than the renderer.
///
/// Internal library functions are inlined and never appear in a gas report on
/// their own, so each component is called through a harness, exactly as
/// CodeRenderer.t.sol and FrameRenderer.t.sol already do.
contract CodeHarness {
    function paths(
        bytes memory code,
        bytes memory mask,
        uint256 offset,
        string memory heartFill,
        string memory noiseFill
    ) external pure returns (string memory) {
        return CodeRenderer.paths(code, mask, offset, heartFill, noiseFill);
    }
}

contract FrameHarness {
    function paths(TokenView memory v, string memory colour, string memory ghostFill)
        external
        pure
        returns (string memory)
    {
        return FrameRenderer.paths(v, colour, ghostFill);
    }
}

contract GasProfileTest is Test {
    Renderer r;
    CodeHarness code;
    FrameHarness frame;

    string constant HEART = "#c8102e";
    string constant NOISE = "#767676";
    string constant GHOST = "#f4eef0";

    /// @dev The two hard limits, repeated from `GasBudget.t.sol` for the same
    /// reason that file repeats them from nowhere: they are the project's
    /// published budget, not one file's private business.
    uint256 constant GAS_LIMIT = 4_000_000;
    uint256 constant BYTE_LIMIT = 24_000;

    /// @dev The largest token the shipping contract can produce -- a finished
    /// child wearing every legal Mark and its place -- as
    /// `RealTokenGas.t.sol` measures it. Named constants rather than two
    /// subtracted literals in a `console.log`, so the headroom this file prints
    /// is computed from the figure it names and one number has to be updated
    /// rather than three kept in agreement.
    ///
    /// This file cannot measure it: it profiles the RENDERER from a view
    /// already in memory and deploys no token. Re-measured 2026-09-23; it was
    /// 2,799,616 / 18,249 while a finished token carried no band and could be
    /// ten rings deep.
    uint256 constant LARGEST_TOKEN_GAS = 3_540_467;
    uint256 constant LARGEST_TOKEN_BYTES = 22_162;

    function setUp() public {
        r = new Renderer();
        code = new CodeHarness();
        frame = new FrameHarness();
    }

    /// @dev The dearest token as RealTokenGas.t.sol defines it: a child on the
    /// day before the heart seals, wearing every Mark that is legal below a
    /// whole heart. Built here as a plain view rather than through the token,
    /// so the profile measures rendering and not storage reads.
    function _dearest() internal pure returns (TokenView memory v) {
        v.tokenId = 30;
        v.level = 364;
        v.streak = 364;
        v.lastDay = 1000;
        v.mintDay = 636;
        v.generation = 1;
        v.parent = 1;
        v.echo = 3650;
        v.today = 1000;
        // Hush, Beat, the bought Iris and Tint: the four a day-364 token can
        // wear, since both sides of pair 4 need a whole heart.
        v.marks = (1 << 1) | (1 << 4) | (1 << 5) | (1 << 9);
        v.code = _bitmap();
    }

    /// @dev A whole FOUNDING token at `level`, so it carries no echo ring unless
    /// the caller sets one. Built fresh each call -- see the note above about
    /// memory structs aliasing.
    function _founding(uint32 level) internal pure returns (TokenView memory v) {
        v.tokenId = 7;
        v.level = level;
        v.streak = 400;
        // The clock has to be past the token's own age: a fixed day 1000
        // underflowed mintDay back when a level could run to nine years.
        v.mintDay = 1000;
        v.lastDay = 1000 + level;
        v.today = 1000 + level;
        v.code = _bitmap();
    }

    function _bitmap() internal pure returns (bytes memory) {
        return
        hex"fe7f926bb8df3fc116bae8ac88906e9d1d71e35bcbb757fff47edfa5dbafffffe6f7d2ec13ebaf1bf3f107fa"
        hex"aaaaaaaaaafe00faebc7bbfb00c77fffffddfd8c5efffffffffffcafff5c61df9df8afbfaebcfbfbf9efffff"
        hex"fe7f9bb78beffffebbe9af7efff5c71df04ffefbfffffffffdff3fffffffddfddf3effffebbfbbfbfffeeefb"
        hex"bbbbfbffbfaebffb8dbfe7fffffffdc75ff7effffffffbbdf3fffdc71dfd9e9cfbfeebffbbfbbc3fffffffff"
        hex"ffff7effffebbfbbfb5fffdc6fdf9dfecf1ffffc7ffb51f7affffebddddad2c7ffff1bfba4727ffeeffbba37"
        hex"fb7bfeeb6fbbfae62e7fffbfddfcc92e7fffffffff7722dfdc7ddf9dfbd68feeb6fb9dbcecbffffdbffefbee"
        hex"0ffffffbfb727b7e7dc7ddfdfb48c93fff7ffffeb9737fffbfddfd6e4e4dffffbfbb336fadeeffbbbb6bef17"
        hex"eeb6fbbef6efa6fffbfddb4cd34b6ffffffd73f69e01c7ddf8590bf11aeb6fbbfaa8032d1bbfffabfc806401"
        hex"51beb0c7bfb0187ade0c2b905c377c5eecf11ba3096fe8120ff5d0c265706c9af2e9f2aedba037bf05c26b87"
        hex"9ae9c0fede58a39525f100";
    }

    function _measure(function() external returns (uint256) f) internal returns (uint256) {
        uint256 before = gasleft();
        f();
        return before - gasleft();
    }

    function test_whereTheDearestTokensGasGoes() public {
        TokenView memory v = _dearest();

        uint256 g0 = gasleft();
        string memory uri = r.tokenURI(v);
        uint256 total = g0 - gasleft();

        g0 = gasleft();
        string memory image = r.svg(v);
        uint256 svgOnly = g0 - gasleft();

        // The code block. Offset 7 is year zero; the dearest token sits deeper,
        // but the offset changes coordinates and not run count, so the figure
        // is representative of what the code costs anywhere.
        g0 = gasleft();
        string memory codePaths = code.paths(v.code, HeartMask.bits(), 7, HEART, NOISE);
        uint256 codeGas = g0 - gasleft();

        g0 = gasleft();
        string memory framePaths = frame.paths(v, HEART, GHOST);
        uint256 frameGas = g0 - gasleft();

        console.log("the dearest token, rendered from a view already in memory");
        console.log("  tokenURI total gas ", total);
        console.log("  tokenURI bytes     ", bytes(uri).length);
        console.log("");
        console.log("  svg() alone        ", svgOnly);
        console.log("  svg bytes          ", bytes(image).length);
        console.log("  json wrapper costs ", total > svgOnly ? total - svgOnly : 0);
        console.log("");
        console.log("  code paths (harness, includes call overhead)", codeGas);
        console.log("  code path bytes    ", bytes(codePaths).length);
        console.log("  frame paths (harness)                      ", frameGas);
        console.log("  frame path bytes   ", bytes(framePaths).length);
        console.log("");
        uint256 parts = codeGas + frameGas;
        console.log("  code + frame       ", parts);
        if (svgOnly > parts) console.log("  everything else in svg()                   ", svgOnly - parts);

        assertGt(total, 0, "a measurement of zero means the profile is not running");
        assertLe(parts, svgOnly + 100_000, "parts must not dwarf the whole");
    }

    /// @notice What base64 costs, and what the alternative would cost.
    ///
    /// @dev The image is embedded as `data:image/svg+xml;base64,...`. Base64
    /// expands by 4/3 and is paid for twice: once in gas to encode, once in
    /// bytes to carry. A plain utf-8 data URI would carry the svg as written.
    ///
    /// This measures the PRIZE, not the change. Two characters stand in the
    /// way of actually taking it and they are counted here rather than guessed
    /// at: every `#` must become `%23` in a data URI, and every `"` would have
    /// to be escaped for JSON unless the renderer switched to single-quoted
    /// attributes.
    function test_whatBase64Costs() public view {
        string memory image = r.svg(_dearest());
        bytes memory raw = bytes(image);

        uint256 g0 = gasleft();
        string memory b64 = Base64.encode(raw);
        uint256 b64Gas = g0 - gasleft();

        g0 = gasleft();
        bytes memory escaped = _escapeHashes(raw);
        uint256 escGas = g0 - gasleft();

        uint256 hashes = 0;
        uint256 quotes = 0;
        for (uint256 i = 0; i < raw.length; i++) {
            if (raw[i] == "#") hashes++;
            else if (raw[i] == '"') quotes++;
        }

        console.log("svg bytes                 ", raw.length);
        console.log("base64 gas                ", b64Gas);
        console.log("base64 bytes              ", bytes(b64).length);
        console.log("percent-escape gas        ", escGas);
        console.log("percent-escaped bytes     ", escaped.length);
        console.log("");
        console.log("gas saved if base64 goes  ", b64Gas > escGas ? b64Gas - escGas : 0);
        console.log("bytes saved if base64 goes", bytes(b64).length - escaped.length);
        console.log("");
        console.log("# in the svg (each becomes %23)     ", hashes);
        console.log('" in the svg (each needs json escape', quotes);

        // A REALISTIC escaper, not a straw man: solady's LibString.replace is
        // assembly and copies word-wise. The naive loop above prices the wrong
        // implementation, and a negative result against the wrong
        // implementation is not a result at all.
        g0 = gasleft();
        string memory viaLib = LibString.replace(image, "#", "%23");
        uint256 libGas = g0 - gasleft();
        console.log("");
        console.log("solady replace gas        ", libGas);
        console.log("solady replace bytes      ", bytes(viaLib).length);
        console.log("gas saved vs base64       ", b64Gas > libGas ? b64Gas - libGas : 0);
        console.log("or COSTS MORE by          ", libGas > b64Gas ? libGas - b64Gas : 0);
    }

    /// @notice CAN FIVE FINISHER MARKS AFFORD TO DRAW ANYTHING?
    ///
    /// @dev Two facts shape the answer before a single byte is measured.
    ///
    /// FIRST, the headroom that applies is NOT the dearest token's. A finisher
    /// Mark needs `requiresWhole`, and the dearest token in the piece is a
    /// day-364 child, which is not whole and can never wear one. The case that
    /// binds is the LARGEST token -- a whole child wearing every legal Mark --
    /// which `RealTokenGas.t.sol` measures. IT IS NO LONGER THE CHEAPER OF THE
    /// TWO IN GAS, and that flipped on 2026-09-23: a finished token now carries
    /// the finisher's digit band, which the day-364 child cannot, so the
    /// largest token is also the dearest. So the budget is that token's
    /// headroom, not the day-364 child's.
    ///
    /// SECOND, the five exclude each other, so a token can wear at most ONE.
    /// Five Marks is not five drawings; it is one drawing with five
    /// treatments. The cost to measure is the cost of ONE.
    ///
    /// This measures the dearest plausible form -- an extra drawn RING, the
    /// shape a finisher's Mark would most naturally take, sitting outside the
    /// code block where it cannot disturb the barcode. An ink-swap Mark is
    /// already known to be free or better: GasBudget.t.sol measures Static as
    /// 3,773 gas CHEAPER than no Static at all (re-measured 2026-09-23).
    function test_whatAFinisherRingWouldCost() public {
        // ONE RING AGAINST TWO, which is the whole range the piece still has:
        // Spec 10f ended the year at 365, so a finished founding token wears one
        // ring and a finished child wears two. This used to compare eight rings
        // with nine.
        //
        // The two views MUST be built separately. `TokenView memory b = a`
        // copies the POINTER, not the struct, so writing b.echo rewrote a.echo
        // and both calls rendered the identical token. That is one of two ways
        // this measurement has come back reading "a ring is free"; the other was
        // a child's ring cap making eight years and nine years the same picture.
        // Both were caught by the byte counts being equal, which is why the
        // assertion below is on bytes.
        TokenView memory one = _founding(365);        // one ring
        TokenView memory two = _founding(365);        // one ring plus the echo
        two.echo = 3650;

        uint256 g0 = gasleft();
        string memory a = frame.paths(one, HEART, GHOST);
        uint256 gasOne = g0 - gasleft();

        g0 = gasleft();
        string memory b = frame.paths(two, HEART, GHOST);
        uint256 gasTwo = g0 - gasleft();

        console.log("frame at one ring  gas", gasOne);
        console.log("frame at one ring  bytes", bytes(a).length);
        console.log("frame at two rings gas", gasTwo);
        console.log("frame at two rings bytes", bytes(b).length);
        console.log("");
        console.log("ONE MORE DRAWN RING COSTS");
        console.log("  gas  ", gasTwo > gasOne ? gasTwo - gasOne : 0);
        console.log("  bytes", bytes(b).length > bytes(a).length ? bytes(b).length - bytes(a).length : 0);
        console.log("");
        assertGt(bytes(b).length, bytes(a).length,
            "a ring that adds no bytes means the two views are the same geometry, not a free ring");
        // The LARGEST token's headroom, computed from the named constants at
        // the head of this file rather than typed in twice. It was 182,700 gas
        // / 7,451 bytes when a finished token carried no band and could be ten
        // rings deep; both numbers moved, and in opposite directions.
        console.log("against the LARGEST token's headroom, measured in RealTokenGas:");
        console.log("  gas  ", GAS_LIMIT - LARGEST_TOKEN_GAS);
        console.log("  bytes", BYTE_LIMIT - LARGEST_TOKEN_BYTES);
    }

    /// @dev The only substitution a data URI actually requires of this svg:
    /// `#` starts a fragment and would truncate the image at the first colour.
    /// Deliberately simple -- it is here to price the work, not to ship.
    function _escapeHashes(bytes memory s) private pure returns (bytes memory out) {
        uint256 extra = 0;
        for (uint256 i = 0; i < s.length; i++) if (s[i] == "#") extra += 2;
        out = new bytes(s.length + extra);
        uint256 j = 0;
        for (uint256 i = 0; i < s.length; i++) {
            if (s[i] == "#") { out[j++] = "%"; out[j++] = "2"; out[j++] = "3"; }
            else out[j++] = s[i];
        }
    }
}
