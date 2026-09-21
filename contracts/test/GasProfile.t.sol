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
/// @dev `RealTokenGas.t.sol` says the dearest token costs about 1.89M against a
/// 2M hard limit, which is 5.5% headroom. That number says the budget is nearly
/// spent; it does not say what spent it. Nothing in the suite broke the total
/// into parts, so every proposal to buy headroom was guesswork.
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

    /// @dev A whole FOUNDING token at `level`, so its own rings are not capped
    /// by an echo ring's slot. Built fresh each call -- see the note above about
    /// memory structs aliasing.
    function _founding(uint32 level) internal pure returns (TokenView memory v) {
        v.tokenId = 7;
        v.level = level;
        v.streak = 400;
        // The clock has to be past the token's own age: level reaches 3,285 at
        // nine years, so a fixed day 1000 underflowed mintDay.
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
    /// binds is the LARGEST token -- a whole child at the ring cap wearing every
    /// legal Mark -- which RealTokenGas.t.sol measures as the cheaper of the two
    /// in gas. So the budget is that token's headroom, not the dearest's.
    ///
    /// SECOND, the five exclude each other, so a token can wear at most ONE.
    /// Five Marks is not five drawings; it is one drawing with five
    /// treatments. The cost to measure is the cost of ONE.
    ///
    /// This measures the dearest plausible form -- an extra drawn RING, the
    /// shape a finisher's Mark would most naturally take, sitting outside the
    /// code block where it cannot disturb the barcode. An ink-swap Mark is
    /// already known to be free or better: GasBudget.t.sol measures Static as
    /// 3,890 gas CHEAPER than no Static at all.
    function test_whatAFinisherRingWouldCost() public {
        // A FOUNDING token, not a child. Measured first on a child and the two
        // cases came back byte-identical: `ringBudget` caps a child's OWN rings
        // at nine once the echo ring claims a slot, so nine years and ten years
        // both draw ten rings. A control that cannot fail looks exactly like a
        // free feature -- the giveaway was two identical byte counts.
        // TWO INDEPENDENT VIEWS, built separately. `TokenView memory b = a`
        // copies the POINTER, not the struct, so writing b.level rewrote a.level
        // and both calls rendered the identical token. That is the second way
        // this measurement came back reading "a ring is free"; the first was a
        // child's ring cap. Both were caught by the byte counts being equal.
        TokenView memory nine = _founding(365 * 8);   // eight rings
        TokenView memory ten = _founding(365 * 9);    // nine rings

        uint256 g0 = gasleft();
        string memory a = frame.paths(nine, HEART, GHOST);
        uint256 gasNine = g0 - gasleft();

        g0 = gasleft();
        string memory b = frame.paths(ten, HEART, GHOST);
        uint256 gasTen = g0 - gasleft();

        console.log("frame at eight rings gas", gasNine);
        console.log("frame at eight rings bytes", bytes(a).length);
        console.log("frame at nine rings  gas", gasTen);
        console.log("frame at nine rings  bytes", bytes(b).length);
        console.log("");
        console.log("ONE MORE DRAWN RING COSTS");
        console.log("  gas  ", gasTen > gasNine ? gasTen - gasNine : 0);
        console.log("  bytes", bytes(b).length > bytes(a).length ? bytes(b).length - bytes(a).length : 0);
        console.log("");
        assertGt(bytes(b).length, bytes(a).length,
            "a ring that adds no bytes means the two views are the same geometry, not a free ring");
        console.log("against the LARGEST token's headroom, measured in RealTokenGas:");
        console.log("  gas   182700");
        console.log("  bytes 7451");
    }

    /// @notice What capping a token's own rings at ONE would buy.
    ///
    /// @dev The operator's decision of 2026-09-20: a token stops accruing at 365
    /// days and draws one ring of its own, rather than earning rings for a
    /// decade. The rings grow the canvas -- 53 cells at one ring, 89 at ten --
    /// and everything on that canvas is billed.
    ///
    /// Measured through the whole `tokenURI`, not the frame alone, because the
    /// canvas width reaches the code's coordinates too.
    function test_whatCappingRingsAtOneWouldSave() public {
        TokenView memory one = _founding(365);          // one ring
        TokenView memory ten = _founding(365 * 10);     // the current cap

        uint256 g0 = gasleft();
        string memory a = r.tokenURI(one);
        uint256 gasOne = g0 - gasleft();

        g0 = gasleft();
        string memory b = r.tokenURI(ten);
        uint256 gasTen = g0 - gasleft();

        console.log("whole founding token, ONE ring");
        console.log("  gas  ", gasOne);
        console.log("  bytes", bytes(a).length);
        console.log("whole founding token, TEN rings (today's cap)");
        console.log("  gas  ", gasTen);
        console.log("  bytes", bytes(b).length);
        console.log("");
        console.log("CAPPING AT ONE SAVES");
        console.log("  gas  ", gasTen > gasOne ? gasTen - gasOne : 0);
        console.log("  bytes", bytes(b).length > bytes(a).length ? bytes(b).length - bytes(a).length : 0);

        assertGt(gasTen, gasOne, "ten rings must cost more than one, or the views are the same token");
    }

    /// @notice The worst case AFTER a token stops at 365 and rings cap at one.
    ///
    /// @dev The budget every finisher-Mark proposal is judged against. Today's
    /// worst case is a child at the TEN-ring cap wearing every legal Mark;
    /// under the 2026-09-20 decision no token ever reaches that, and the worst
    /// a finisher can be is a whole child with its own single ring plus the
    /// echo ring it was seeded with.
    ///
    /// This is the number that decides whether a PATTERNED ring is affordable
    /// on every finisher, rather than on the single rarest token.
    function test_theWorstCaseOnceRingsCapAtOne() public {
        // Today: a child at the ring cap, every legal Mark.
        TokenView memory old_ = _dearest();
        old_.level = 365 * 10;
        old_.streak = 400;
        old_.echo = 3650;
        old_.marks = (1 << 1) | (1 << 4) | (1 << 5) | (1 << 7) | (1 << 9);

        // Under the new rule: whole, ONE own ring, plus the echo ring.
        TokenView memory now_ = _dearest();
        now_.level = 365;
        now_.streak = 365;
        now_.echo = 365;
        now_.marks = (1 << 1) | (1 << 4) | (1 << 5) | (1 << 7) | (1 << 9);

        uint256 g0 = gasleft();
        string memory a = r.tokenURI(old_);
        uint256 gasOld = g0 - gasleft();

        g0 = gasleft();
        string memory b = r.tokenURI(now_);
        uint256 gasNow = g0 - gasleft();

        console.log("TODAY  child at the ring cap, every legal Mark");
        console.log("  gas  ", gasOld);
        console.log("  bytes", bytes(a).length);
        console.log("AFTER  whole child, one own ring + echo, every legal Mark");
        console.log("  gas  ", gasNow);
        console.log("  bytes", bytes(b).length);
        console.log("");
        console.log("HEADROOM under the 2,000,000 hard limit");
        console.log("  today", gasOld < 2_000_000 ? 2_000_000 - gasOld : 0);
        console.log("  after", gasNow < 2_000_000 ? 2_000_000 - gasNow : 0);
        console.log("");
        console.log("for scale: the DASHED echo ring costs 145,533 gas for 54 runs");
        console.log("           a solid ring costs 3,705 for 4 runs");

        assertLt(gasNow, gasOld, "capping the rings must be cheaper, or the views are wrong");
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
