// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {MroTestBase} from "./MroTestBase.sol";

/// @notice One answer bit per credit: credit `level` is bit `level - 1`.
contract AnswerBitsTest is MroTestBase {
    function setUp() public {
        _deployAndMintOne();
    }

    function _bitOf(uint256 id, uint256 i) internal view returns (uint256) {
        uint256[2] memory a = t.answersOf(id);
        return (a[i >> 8] >> (i & 255)) & 1;
    }

    function test_aOneBitIsWrittenAtItsCredit() public {
        uint32 d = _today() + 1;
        _warpToDay(d);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(d), hex"80", hex"01");
        assertEq(_bitOf(1, 1), 1, "credit 2 is bit 1");
        assertEq(_bitOf(1, 0), 0, "the mint's bit was 0");
    }

    function test_aZeroBitWritesNothing() public {
        uint32 d = _today() + 1;
        _warpToDay(d);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(d), hex"00", hex"ff");
        uint256[2] memory a = t.answersOf(1);
        assertEq(a[0], 0);
        assertEq(a[1], 0);
    }

    function test_bitsFollowEntryOrderAcrossTokens() public {
        vm.prank(WARDEN);
        t.mint(2, address(0x2222), bytes32(uint256(2)), _code(), _today(), true);
        uint32 d = _today() + 1;
        _warpToDay(d);
        uint32[] memory ids = new uint32[](2);
        uint32[] memory ds = new uint32[](2);
        ids[0] = 1; ids[1] = 2; ds[0] = d; ds[1] = d;
        vm.prank(WARDEN);
        t.batchCheckIn(_packed(ids), ds, hex"40", hex"0001");
        assertEq(_bitOf(1, 1), 0, "entry 0 carried a 0");
        assertEq(_bitOf(2, 1), 1, "entry 1 carried a 1");
        assertEq(_bitOf(2, 0), 1, "token 2's mint carried a 1");
    }

    function test_theLastCreditWritesBit364() public {
        _growTo(1, 364);
        uint32 d = t.viewOf(1).lastDay + 1;
        _warpToDay(d);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(d), hex"80", hex"00");
        assertEq(_bitOf(1, 364), 1);
    }

    function test_answerBitsOfTheWrongLengthAreRefused() public {
        uint32 d = _today() + 1;
        _warpToDay(d);
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.LengthMismatch.selector);
        t.batchCheckIn(_one(1), _days(d), hex"", hex"00");
    }

    function test_aRecordOfTheWrongLengthIsRefused() public {
        uint32 d = _today() + 1;
        _warpToDay(d);
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.LengthMismatch.selector);
        t.batchCheckIn(_one(1), _days(d), hex"00", hex"");
    }

    function test_viewOfCarriesTheAnswers() public {
        uint32 d = _today() + 1;
        _warpToDay(d);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(d), hex"80", hex"01");
        assertEq(t.viewOf(1).answers[0], 2);
    }

    function test_aSeededChildCarriesItsFirstAnswer() public {
        _makeWhole(1);
        while (t.seedsAvailable(1) == 0) _warpToDay(t.today() + 365);
        uint32 day = _today();
        bytes memory code = _code();
        vm.prank(WARDEN);
        t.seed(901, 1, ALICE, code, day, KEY, true);
        assertEq(_bitOf(901, 0), 1);
    }

    /// @dev The answers are two words: credit 256 is bit 255 of word 0, and
    /// credit 257 is bit 0 of word 1.
    function test_theWordBoundaryIsCrossedCleanly() public {
        _growTo(1, 255);
        for (uint32 k; k < 2; ++k) {
            uint32 d = t.viewOf(1).lastDay + 1;
            _warpToDay(d);
            vm.prank(WARDEN);
            t.batchCheckIn(_one(1), _days(d), hex"80", hex"00");
        }
        uint256[2] memory a = t.answersOf(1);
        assertEq(a[0] >> 255, 1, "credit 256 is the top bit of word 0");
        assertEq(a[1] & 1, 1, "credit 257 is the bottom bit of word 1");
        assertEq(_bitOf(1, 254), 0);
        assertEq(_bitOf(1, 257), 0);
    }
}
