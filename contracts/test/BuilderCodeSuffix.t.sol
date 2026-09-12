// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MroTestBase} from "./MroTestBase.sol";
import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";

/// @notice The Base Builder Code rides on the END of every transaction the
/// Clock sends, as an ERC-8021 calldata suffix (warden/src/clock/builder-code.mjs).
/// Solidity decodes only the arguments the ABI describes, and no function in
/// this contract reads raw calldata, so trailing bytes should change nothing.
/// This pins that for each of the four functions the Clock calls: the same call
/// is made twice from one snapshot, plain and with the suffix, and both must
/// succeed and leave the token in the same state.
contract BuilderCodeSuffixTest is MroTestBase {
    /// @dev ERC-8021 schema 0 for the made-up code "bc_test1234": its ASCII
    /// bytes, length 0x0b, schema 0x00, then 0x8021 x8. The warden test
    /// clock-builder-code.test.mjs rebuilds the same bytes by hand.
    bytes internal constant SUFFIX = hex"62635f74657374313233340b0080218021802180218021802180218021";

    bytes32 internal constant KEY_TWO = bytes32(uint256(0xb0b));

    function setUp() public {
        _deployAndMintOne();
    }

    /// @dev Run `data` as the Warden plain and then suffixed, from the same
    /// state, and require identical outcomes for token `id`.
    function _sameWithAndWithout(bytes memory data, uint256 id) internal {
        bytes memory suffixed = abi.encodePacked(data, SUFFIX);
        assertEq(suffixed.length, data.length + 29, "the suffix is 29 bytes");

        uint256 snap = vm.snapshotState();
        vm.prank(WARDEN);
        (bool okPlain, bytes memory retPlain) = address(t).call(data);
        assertTrue(okPlain, "the plain call failed");
        bytes32 plainState = keccak256(abi.encode(t.viewOf(id), t.ownerOf(id)));

        vm.revertToState(snap);
        vm.prank(WARDEN);
        (bool okSuffixed, bytes memory retSuffixed) = address(t).call(suffixed);
        assertTrue(okSuffixed, "the call with the Builder Code suffix failed");
        assertEq(retSuffixed, retPlain, "the return data differs with the suffix");
        assertEq(
            keccak256(abi.encode(t.viewOf(id), t.ownerOf(id))), plainState, "the token's state differs with the suffix"
        );
    }

    function test_mintIgnoresTheSuffix() public {
        _sameWithAndWithout(abi.encodeCall(MachineReadableOnly.mint, (2, ALICE, KEY_TWO, _code(), _today())), 2);
    }

    function test_batchCheckInIgnoresTheSuffix() public {
        _warpToDay(t.today() + 1);
        _sameWithAndWithout(abi.encodeCall(MachineReadableOnly.batchCheckIn, (_one(1), _days(_today()))), 1);
    }

    function test_applyMarkIgnoresTheSuffix() public {
        // A Mark must be configured before it can be applied; the same cheap,
        // ungated setup Marks.t.sol uses. This test contract deployed the pair,
        // so it is the owner that setUpgrade requires.
        t.setUpgrade(
            1,
            MachineReadableOnly.Upgrade({
                priceUsdc6: 1_000_000,
                maxSupply: 0,
                sold: 0,
                minLevel: 0,
                minStreak: 0,
                requiresWhole: false,
                active: true,
                excludes: 0,
                requiresAny: 0
            })
        );
        _sameWithAndWithout(abi.encodeCall(MachineReadableOnly.applyMark, (1, 1, 0)), 1);
    }

    function test_seedIgnoresTheSuffix() public {
        _makeWhole(1);
        while (t.seedsAvailable(1) == 0) _warpToDay(t.today() + 365);
        uint256 child = 901;
        _sameWithAndWithout(
            abi.encodeCall(MachineReadableOnly.seed, (child, 1, address(uint160(0x5EED0000 + child)), _code(), _today())),
            child
        );
    }
}
