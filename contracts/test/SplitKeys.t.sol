// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {MroTestBase} from "./MroTestBase.sol";

/// @notice The split's key chain: fixed by an anchor before opening, walked
/// forward one key per day, never past a day that is not over.
contract SplitKeysTest is MroTestBase {
    bytes32[] internal k;

    function setUp() public {
        _deployAndMintOne();
        k = _splitChain(keccak256("test split seed"), 40);
    }

    function _keys(uint256 from, uint256 count) internal view returns (bytes32[] memory out) {
        out = new bytes32[](count);
        for (uint256 i; i < count; ++i) out[i] = k[from + i];
    }

    function test_theAnchorIsSetOnceByTheOwner() public {
        t.setSplitAnchor(k[0]);
        assertEq(t.splitAnchor(), k[0]);
        assertEq(t.lastSplitKey(), k[0]);
        assertEq(t.splitAnchorDay(), _today());
        vm.expectRevert(MachineReadableOnly.SplitAnchorAlreadySet.selector);
        t.setSplitAnchor(k[1]);
    }

    function test_aStrangerCannotSetTheAnchor() public {
        vm.prank(MALLORY);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, MALLORY));
        t.setSplitAnchor(k[0]);
    }

    function test_aZeroAnchorIsRefused() public {
        vm.expectRevert(MachineReadableOnly.ZeroSplitAnchor.selector);
        t.setSplitAnchor(bytes32(0));
    }

    function test_settingTheAnchorEmits() public {
        uint32 d = _today();
        vm.expectEmit(address(t));
        emit MachineReadableOnly.SplitAnchorSet(k[0], d);
        t.setSplitAnchor(k[0]);
    }

    function test_nothingIsRevealedBeforeTheAnchor() public {
        bytes32[] memory one = _keys(1, 1);
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.NoSplitAnchor.selector);
        t.revealSplitKeys(one, "");
    }

    function test_keysAreRevealedInOrderOnceTheirDayIsOver() public {
        t.setSplitAnchor(k[0]);
        _warpToDay(_today() + 3);
        bytes32[] memory three = _keys(1, 3);
        vm.prank(WARDEN);
        t.revealSplitKeys(three, "[]");
        assertEq(t.splitKeysRevealed(), 3);
        assertEq(t.lastSplitKey(), k[3]);
    }

    function test_todaysKeyIsNeverRevealed() public {
        t.setSplitAnchor(k[0]);
        _warpToDay(_today() + 2);
        bytes32[] memory three = _keys(1, 3);
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.SplitKeyTooEarly.selector, uint32(3)));
        t.revealSplitKeys(three, "");
    }

    function test_aSkippedKeyIsRefused() public {
        t.setSplitAnchor(k[0]);
        _warpToDay(_today() + 5);
        bytes32[] memory skip = new bytes32[](2);
        skip[0] = k[1]; skip[1] = k[3];
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.BadSplitKey.selector, uint32(2)));
        t.revealSplitKeys(skip, "");
    }

    function test_aRepeatedKeyIsRefused() public {
        t.setSplitAnchor(k[0]);
        _warpToDay(_today() + 5);
        bytes32[] memory one = _keys(1, 1);
        vm.prank(WARDEN);
        t.revealSplitKeys(one, "");
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.BadSplitKey.selector, uint32(2)));
        t.revealSplitKeys(one, "");
    }

    function test_aKeyNotOnTheChainIsRefused() public {
        t.setSplitAnchor(k[0]);
        _warpToDay(_today() + 5);
        bytes32[] memory wrong = new bytes32[](1);
        wrong[0] = keccak256("not on the chain");
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.BadSplitKey.selector, uint32(1)));
        t.revealSplitKeys(wrong, "");
    }

    function test_onlyTheWardenReveals() public {
        t.setSplitAnchor(k[0]);
        _warpToDay(_today() + 5);
        bytes32[] memory one = _keys(1, 1);
        vm.prank(MALLORY);
        vm.expectRevert(MachineReadableOnly.NotWarden.selector);
        t.revealSplitKeys(one, "");
    }

    function test_eachRevealPointsBackAtThePreviousOne() public {
        t.setSplitAnchor(k[0]);
        _warpToDay(_today() + 5);
        vm.roll(100);
        bytes32[] memory a = _keys(1, 2);
        vm.prank(WARDEN);
        t.revealSplitKeys(a, "");
        assertEq(t.lastRevealBlock(), 100);
        vm.roll(250);
        bytes32[] memory b = _keys(3, 1);
        vm.expectEmit(address(t));
        emit MachineReadableOnly.SplitKeysRevealed(3, b, 100, "q");
        vm.prank(WARDEN);
        t.revealSplitKeys(b, "q");
        assertEq(t.lastRevealBlock(), 250);
    }

    function test_anEmptyRevealStillMarksTheNight() public {
        t.setSplitAnchor(k[0]);
        vm.roll(300);
        bytes32[] memory none = new bytes32[](0);
        vm.prank(WARDEN);
        t.revealSplitKeys(none, "");
        assertEq(t.lastRevealBlock(), 300);
        assertEq(t.splitKeysRevealed(), 0);
    }

    function test_aRevealAfterSunsetIsAllowed() public {
        t.setSplitAnchor(k[0]);
        _warpToDay(_today() + 5);
        t.sunset();
        bytes32[] memory one = _keys(1, 1);
        vm.prank(WARDEN);
        t.revealSplitKeys(one, "");
        assertEq(t.splitKeysRevealed(), 1);
    }
}
