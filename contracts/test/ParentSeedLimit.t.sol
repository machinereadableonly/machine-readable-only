// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {MroTestBase} from "./MroTestBase.sol";

/// @notice A parent seeds at most once per full year since it was made,
/// whatever key it is bound to (D8.1).
contract ParentSeedLimitTest is MroTestBase {
    bytes32 internal constant KEY2 = bytes32(uint256(0xC0FFEE));

    function setUp() public {
        _deployAndMintOne();
        // A second key with the same tenure, held by the same owner.
        vm.prank(WARDEN);
        t.mint(2, ALICE, KEY2, _code(), _today(), false);
    }

    function _seedAs(uint256 parentId, bytes32 key, uint256 childId) internal {
        uint32 day = _today();
        bytes memory code = _code();
        vm.prank(WARDEN);
        t.seed(childId, parentId, address(uint160(0x5EED0000 + childId)), code, day, key, false);
    }

    /// Rebinding a whole parent to a second key no longer buys it a second seed.
    function test_aRebindDoesNotBuyAParentASecondSeed() public {
        _makeWhole(1);
        while (t.seedsAvailable(1) == 0) _warpToDay(t.today() + 365);
        _seedAs(1, KEY, 901);
        assertEq(t.seedsAvailable(1), 0, "the parent has used its year");

        vm.prank(ALICE);
        t.rebind(1, KEY2);
        assertEq(t.seedsAvailable(1), 0, "a new key does not reset the parent");
        uint32 day = _today();
        bytes memory code = _code();
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.NoSeedAvailable.selector);
        t.seed(902, 1, address(0x5EED0902), code, day, KEY2, false);
    }

    /// CONTROL: the same rebind a year later does seed, because the parent has
    /// had another full year.
    function test_aParentSeedsAgainAfterAnotherYear() public {
        _makeWhole(1);
        while (t.seedsAvailable(1) == 0) _warpToDay(t.today() + 365);
        _seedAs(1, KEY, 901);
        vm.prank(ALICE);
        t.rebind(1, KEY2);
        _warpToDay(t.today() + 365);
        assertEq(t.seedsAvailable(1), 1);
        _seedAs(1, KEY2, 902);
        assertEq(t.viewOf(1).seedsGiven, 2);
    }

    /// The key's own budget still binds: two parents on one key share it.
    function test_theKeyBudgetStillBinds() public {
        vm.prank(ALICE);
        t.rebind(2, KEY);
        _makeWhole(1);
        _growTo(2, 365);
        while (t.seedsAvailable(1) == 0) _warpToDay(t.today() + 365);
        assertEq(t.seedsAvailable(1), 1);
        assertEq(t.seedsAvailable(2), 1);
        _seedAs(1, KEY, 901);
        assertEq(t.seedsAvailable(2), 0, "token 2's own year is unspent, but KEY's is not");
    }

    function test_anUnknownParentHasNoSeeds() public view {
        assertEq(t.seedsAvailable(77), 0);
    }
}
