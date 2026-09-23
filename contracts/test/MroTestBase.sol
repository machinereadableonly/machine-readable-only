// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";

/// @notice What every MachineReadableOnly test needs: the contract pair, the
/// standard addresses, the code bitmap and the calldata helpers.
/// @dev Shared rather than copied. The same 407 bytes appear in six test
/// files, and a second copy is a second thing to update when the fixture is
/// regenerated.
abstract contract MroTestBase is Test {
    MachineReadableOnly internal t;
    Renderer internal r;

    address internal constant WARDEN = address(0x3A2D);
    address internal constant ALICE = address(0xA11CE);
    address internal constant MALLORY = address(0x4A11);

    bytes32 internal constant KEY = bytes32(uint256(0xa9e));

    /// @dev Token 1 on example.com, from tools/token-bitmap.mjs. The same 407
    /// bytes the renderer tests use.
    function _code() internal pure returns (bytes memory) {
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

    /// @dev Ids travel as 4-byte big-endian values, which is what
    /// batchCheckIn decodes.
    function _packed(uint32[] memory ids) internal pure returns (bytes memory out) {
        for (uint256 i = 0; i < ids.length; i++) out = abi.encodePacked(out, ids[i]);
    }

    /// @dev A single packed id, for the common one-token batchCheckIn call.
    function _one(uint32 id) internal pure returns (bytes memory) {
        uint32[] memory ids = new uint32[](1);
        ids[0] = id;
        return _packed(ids);
    }

    /// @dev A single-element day array, for the common one-token batchCheckIn call.
    function _days(uint32 day) internal pure returns (uint32[] memory out) {
        out = new uint32[](1);
        out[0] = day;
    }

    /// @dev Today's day number, computed HERE rather than read from `t`, so it
    /// can sit inside the arguments of a call under `vm.expectRevert`: an
    /// external `t.today()` there would be the call the cheatcode matched
    /// (foundry-test-traps). The contract's own formula, `timestamp / 1 days`.
    ///
    /// `vm.getBlockTimestamp()`, NOT `block.timestamp`: under via_ir the
    /// optimiser treats `block.timestamp` as one value per function (see
    /// `_warpToDay`), so after a `vm.warp` in the same test it still read the
    /// old time -- three seed tests passed day 1000 while the contract stood at
    /// 1,729 and were refused StaleDay. A cheatcode call is not a call
    /// `vm.expectRevert` counts, so the trap above stays closed.
    function _today() internal view returns (uint32) {
        return uint32(vm.getBlockTimestamp() / 1 days);
    }

    /// @dev Deploy the pair and mint token 1 to ALICE, past day zero so that
    /// `lastDay + 1` arithmetic is meaningful.
    function _deployAndMintOne() internal {
        r = new Renderer();
        t = new MachineReadableOnly(address(r), WARDEN);
        vm.warp(86_400 * 1000 + 1);
        vm.prank(WARDEN);
        t.mint(1, ALICE, KEY, _code(), _today());
    }

    /// @dev Advance the clock by one year. NEVER write `vm.warp(block.timestamp
    /// + 365 days)` inline a second time in the same test function -- under
    /// this project's `via_ir = true` (foundry.toml, load-bearing for gas),
    /// solc's Yul common-subexpression pass treats `block.timestamp` as
    /// invariant across a function body, which is true of the real opcode but
    /// not of the out-of-band patch `vm.warp` performs. Two textually
    /// identical `block.timestamp + 365 days` expressions in one function
    /// collapse to the SAME computed value, so the second warp silently does
    /// nothing -- confirmed with a minimal standalone repro (two bare
    /// `vm.warp(block.timestamp + 365 days)` calls with nothing between them
    /// still coalesce). Wrapping the expression in this helper and calling it
    /// per year avoids the trap, because each call recomputes it fresh.
    function _warpOneYear() internal {
        vm.warp(block.timestamp + 365 days);
    }

    /// @dev Move the chain clock to the UTC day index `day`, the unit the
    /// contract counts in. Needed because a day can no longer be credited
    /// before the chain reaches it: `batchCheckIn` and `checkInWithVoucher`
    /// both reject `day > today()`. Warps to an ABSOLUTE timestamp rather than
    /// `block.timestamp + n`, which sidesteps the via_ir common-subexpression
    /// trap documented on `_warpOneYear` above. A no-op if already past `day`.
    function _warpToDay(uint32 day) internal {
        uint256 target = uint256(day) * 1 days + 1;
        if (target > block.timestamp) vm.warp(target);
    }

    /// @dev Put a token at an arbitrary level by checking it in repeatedly is
    /// far too slow, so the budget tests warp the clock and check in once per
    /// needed day instead. 365 check-ins is affordable in a test; a decade is
    /// not, which is why seedsAvailable is asserted directly.
    /// @dev Moved here from Lifecycle.t.sol so a second test file (the golden
    /// tokenURI test) can share it rather than keep a second copy.
    /// @dev It ADVANCES THE CLOCK by 364 days, which it must, because a day can
    /// no longer be credited before the chain reaches it. The seed-budget tests
    /// depend on that figure: they warp a further year and expect a budget of
    /// exactly 1, which holds at 364 (729 days of tenure) and would flip to 2
    /// at 366 (731). Changing this count changes those tests' arithmetic -- they
    /// will fail loudly rather than drift, but they will fail.
    /// @dev IT ALSO FINISHES THE TOKEN, since 2026-09-23: the credit that
    /// reaches 365 gives it a place and one of the five finisher Marks, so the
    /// first token a test makes whole comes back wearing bit 15 and ordinal 1,
    /// and it can never be credited again.
    function _makeWhole(uint256 id) internal {
        uint32 d = t.today();
        uint32[] memory ids = new uint32[](364);
        uint32[] memory ds = new uint32[](364);
        for (uint32 i = 0; i < 364; i++) {
            ids[i] = uint32(id);
            ds[i] = d + 1 + i;
        }
        bytes memory packed;
        for (uint32 i = 0; i < 364; i++) packed = abi.encodePacked(packed, ids[i]);
        _warpToDay(d + 364);
        vm.prank(WARDEN);
        t.batchCheckIn(packed, ds);
        assertEq(t.viewOf(id).level, 365);
    }

    /// @dev Credit days until `id` sits at exactly `target` level, in ONE
    /// batchCheckIn. Same shape as `_makeWhole` and same reason: a day cannot
    /// be credited before the chain reaches it, so the clock is warped to the
    /// last day of the run BEFORE the call. A no-op if the token is already at
    /// or past `target`.
    function _growTo(uint256 id, uint32 target) internal {
        uint32 have = t.viewOf(id).level;
        if (have >= target) return;
        uint32 n = target - have;
        uint32 d = t.today();
        uint32[] memory ids = new uint32[](n);
        uint32[] memory ds = new uint32[](n);
        for (uint32 i = 0; i < n; i++) {
            ids[i] = uint32(id);
            ds[i] = d + 1 + i;
        }
        _warpToDay(d + n);
        vm.prank(WARDEN);
        t.batchCheckIn(_packed(ids), ds);
        assertEq(t.viewOf(id).level, target, "_growTo did not reach its target");
    }

    /// @dev Ids and recipients for `_seedFrom`. Well above the small literal
    /// ids the other fixtures mint by hand, so a seeded child can never
    /// collide with one, and one address per child so `walletCap` (20) can
    /// never be what fails a lineage test.
    uint256 internal _nextSeedId = 900;

    /// @dev Seed a child from `parentId` as the Warden and return its id.
    ///
    /// It moves the clock first. The seed budget is per agent KEY and per
    /// completed YEAR of that key's tenure ("tenure, not depth"), so a parent
    /// that has just been made whole has earned nothing yet -- 364 days is not
    /// a year. Warping in whole years here keeps the arithmetic in one place
    /// instead of every caller remembering it.
    ///
    /// The clock is read back off the contract each time rather than computed
    /// from `block.timestamp` inline, which sidesteps the via_ir
    /// common-subexpression trap documented on `_warpOneYear`.
    function _seedFrom(uint256 parentId) internal returns (uint256 childId) {
        while (t.seedsAvailable(parentId) == 0) _warpToDay(t.today() + 365);
        childId = ++_nextSeedId;
        vm.prank(WARDEN);
        t.seed(childId, parentId, address(uint160(0x5EED0000 + childId)), _code(), _today());
    }
}
