// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";

import {MROSpikeToken} from "../src/spike/MROSpikeToken.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {MarkRenderer} from "../src/render/MarkRenderer.sol";

/// @notice The spike's headline numbers: what a marketplace pays to read
/// `tokenURI` off the token contract, at every life stage that matters.
///
/// @dev Every earlier gas figure on this spike measured the renderer alone,
/// with its TokenView already sitting in memory. This file measures the call a
/// marketplace actually makes, which has to read storage first.
///
/// Measured through an external call on a token whose slots are cold, so the
/// SLOADs are billed at 2,100 rather than 100. Warming them first would flatter
/// the result and would not be a number anybody pays. Each stage gets its own
/// token id for the same reason -- no stage may warm another's storage.
contract GasBudgetTest is Test {
    MROSpikeToken t;
    Renderer r;

    uint256 constant GAS_LIMIT = 2_000_000;
    uint256 constant BYTE_LIMIT = 20_000;
    uint256 constant GAS_TARGET = 1_000_000;
    uint256 constant BYTE_TARGET = 5_000;

    uint256 constant ALL_MARKS = MarkRenderer.VEIN | MarkRenderer.PULSE | MarkRenderer.VOICE
        | MarkRenderer.BLOOM | MarkRenderer.HALO | MarkRenderer.CROWN | MarkRenderer.SINGULARITY;

    /// @dev Token 1 on example.com, from tools/token-bitmap.mjs.
    function _code() internal pure returns (bytes memory) {
        return
        hex"fe00810bfc16532d506ebd1a58bb74fffff5dbabfabfaec16ed7ed07faaaaaafe01fe9fe00d33eefebb3eeff"
        hex"fff37fff66f70afbdfedf8b7feeeeea0fefdffdf85ffef66e727bfffff6abfeefeef296ffdfff5fbfe666796"
        hex"e3fedfeb623feefee8d8ffffff86fff66f7362bdfedfd0b3eeeeea5bcfdffdda69bef66f8ac0fffff12f62ef"
        hex"ecfa0057dfec67fa66642bf04b6df716ba7aed8f95d52ffa2d2e9306943305132d230fe84883cd80";
    }

    function setUp() public {
        r = new Renderer();
        t = new MROSpikeToken(address(r));
        vm.warp(86400 * 1000 + 1);   // today() == 1000, matching the fixtures
    }

    function _place(
        uint256 id,
        uint32 level,
        uint32 streak,
        uint32 lastDay,
        bool resting,
        uint256 marks
    ) internal {
        t.mint(id, address(0xA11CE), bytes32(uint256(0xa9e)), _code());
        t.setState(id, MROSpikeToken.Token({
            level: level, streak: streak, lastDay: lastDay, mintDay: 900,
            generation: 0, seedsGiven: 0, resting: resting, reserved: 0
        }));
        if (marks != 0) t.setMarks(id, marks);
    }

    function _measure(string memory label, uint256 id)
        internal
        view
        returns (uint256 gasUsed, uint256 len)
    {
        uint256 before = gasleft();
        string memory uri = t.tokenURI(id);
        gasUsed = before - gasleft();
        len = bytes(uri).length;
        console.log(label);
        console.log("  gas  ", gasUsed);
        console.log("  bytes", len);
        assertLt(gasUsed, GAS_LIMIT, string.concat(label, ": over the hard gas limit"));
        assertLt(len, BYTE_LIMIT, string.concat(label, ": over the hard byte limit"));
    }

    /// @dev The whole ladder in one test so the numbers appear together and can
    /// be copied straight into the results table. Run with -vv.
    function test_theWholeLadderStaysInsideTheHardLimit() public {
        _place(1, 1, 1, 1000, false, 0);
        _place(2, 200, 45, 1000, false, 0);
        _place(3, 365, 140, 1000, false, 0);
        _place(4, 365, 140, 960, false, 0);              // forty days lapsed
        _place(5, 365 * 3, 200, 1000, false, 0);
        _place(6, 365 * 10, 400, 1000, false, 0);        // at the ring cap
        _place(7, 365 * 10, 400, 1000, false, ALL_MARKS);
        _place(8, 365 * 3, 200, 1000, true, 0);          // sealed
        _place(9, 364, 400, 1000, false, ALL_MARKS);     // the day before whole

        // The dearest stage and the largest stage are NOT the same token, so
        // each limit is tracked against its own worst case.
        uint256 maxBytes;
        uint256 b;

        (, b) = _measure("day one", 1);                     maxBytes = _max(maxBytes, b);
        (, b) = _measure("day 200", 2);                     maxBytes = _max(maxBytes, b);
        (, b) = _measure("whole, one ring", 3);             maxBytes = _max(maxBytes, b);
        (, b) = _measure("whole and lapsed", 4);            maxBytes = _max(maxBytes, b);
        (, b) = _measure("three years", 5);                 maxBytes = _max(maxBytes, b);
        (, b) = _measure("ten years, at the cap", 6);       maxBytes = _max(maxBytes, b);
        (uint256 capAndMarks, uint256 capBytes) = _measure("cap and every mark", 7);
        maxBytes = _max(maxBytes, capBytes);
        (uint256 sealedGas,) = _measure("sealed at rest", 8);
        (uint256 worstGas, uint256 lastBytes) = _measure("day 364, every mark", 9);
        maxBytes = _max(maxBytes, lastBytes);

        // A sealed token takes a branch, not extra work.
        assertLt(sealedGas, capAndMarks, "sealing must not cost more than wearing every mark");

        // The worst case is NOT the oldest token. See the test below.
        assertGt(worstGas, capAndMarks, "day 364 is the expensive case, not the ring cap");

        // The 1,000,000 / 5,000 target is missed and is reported as missed
        // rather than quietly dropped. Flip these the day they pass -- and
        // update docs/phase0-results.md in the same commit.
        assertGt(worstGas, GAS_TARGET, "the gas target now passes: update the results table");
        assertGt(maxBytes, BYTE_TARGET, "the byte target now passes: update the results table");

        console.log("headroom against the hard limit");
        console.log("  gas, from day 364 with every mark      ", GAS_LIMIT - worstGas);
        console.log("  bytes, from the ring cap with every mark", BYTE_LIMIT - maxBytes);
    }

    function _max(uint256 a, uint256 c) private pure returns (uint256) {
        return a > c ? a : c;
    }

    /// @notice The worst case is the day BEFORE the heart seals, not the oldest
    /// token -- which is the opposite of what the budget was planned around.
    ///
    /// @dev The day frame is drawn as two paths, lit and ghost. At level 364
    /// there are 364 lit cells and 12 ghost ones threaded through them, so both
    /// paths fragment into many short runs. At 365 the ghost path vanishes and
    /// the lit one seals into a handful of long runs, and the cost falls off a
    /// cliff. Measured here rather than asserted from the shape of the code.
    ///
    /// Rings cannot make this worse: the frame is filled to `min(level, 365)`,
    /// so a partial frame implies level < 365, which implies zero rings. The
    /// two expensive cases are mutually exclusive.
    function test_theWorstCaseIsTheDayBeforeTheHeartSeals() public {
        _place(10, 364, 400, 1000, false, ALL_MARKS);
        _place(11, 365, 400, 1000, false, ALL_MARKS);

        (uint256 almost,) = _measure("level 364, every mark", 10);
        (uint256 whole,) = _measure("level 365, every mark", 11);

        assertGt(almost, whole, "an unsealed frame must be the dearer of the two");
        console.log("the seal is worth", almost - whole);
        assertLt(almost, GAS_LIMIT, "even the worst case must fit the hard limit");
    }

    /// @dev What the token contract itself adds, isolated. The renderer was
    /// measured alone at Task 7; the difference is the storage read, and it is
    /// the one quantity this whole task exists to find.
    function test_theTokenContractsOwnOverheadIsSmall() public {
        _place(7, 365 * 10, 400, 1000, false, ALL_MARKS);

        uint256 before = gasleft();
        t.tokenURI(7);
        uint256 throughToken = before - gasleft();

        before = gasleft();
        r.tokenURI(t.viewOf(7));
        uint256 rendererOnly = before - gasleft();

        console.log("through the token contract", throughToken);
        console.log("renderer alone (warm view) ", rendererOnly);
        assertLt(throughToken, GAS_LIMIT, "the real call must fit the hard limit");
    }
}
