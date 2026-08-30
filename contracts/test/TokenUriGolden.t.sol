// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {MroTestBase} from "./MroTestBase.sol";

/// @notice The contract and the Phase 0 renderer, end to end.
///
/// @dev A STUBBED renderer would hide exactly the class of bug this exists to
/// catch: the contract and the renderer disagreeing about a field's meaning.
/// So this drives the real Renderer and asserts on what comes back.
contract TokenUriGoldenTest is MroTestBase {

    function setUp() public {
        _deployAndMintOne();
    }

    function _contains(string memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length > h.length) return false;
        for (uint256 i = 0; i <= h.length - n.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) { ok = false; break; }
            }
            if (ok) return true;
        }
        return false;
    }

    function test_tokenUriIsAJsonDataUriWithABase64Image() public view {
        string memory uri = t.tokenURI(1);
        assertTrue(_contains(uri, "data:application/json"), "json data uri");
        assertTrue(_contains(uri, "image"), "has an image field");
        assertTrue(_contains(uri, "data:image/svg+xml;base64,"), "base64 svg image");
    }

    function test_tokenUriCarriesTheLevelAttribute() public view {
        string memory uri = t.tokenURI(1);
        assertTrue(_contains(uri, "Level"), "Level attribute present");
        assertTrue(_contains(uri, "Generation"), "Generation attribute present");
        assertTrue(_contains(uri, "Parent"), "Parent attribute present");
    }

    function test_tokenUriRevertsForANonexistentToken() public {
        vm.expectRevert();
        t.tokenURI(999);
    }

    /// @dev The worst case from Phase 0 is the day BEFORE the heart seals.
    /// This is the contract-level version of the gas budget the spike measured.
    function test_worstCaseTokenUriStaysInsideTheHardLimit() public {
        // Drive the token to level 364 the cheap way: one call, many days.
        uint32 d = t.today();
        uint32[] memory ds = new uint32[](363);
        bytes memory packed;
        for (uint32 i = 0; i < 363; i++) {
            ds[i] = d + 1 + i;
            packed = abi.encodePacked(packed, uint32(1));
        }
        vm.prank(WARDEN);
        t.batchCheckIn(packed, ds);
        assertEq(t.viewOf(1).level, 364);

        uint256 before = gasleft();
        string memory uri = t.tokenURI(1);
        uint256 used = before - gasleft();

        emit log_named_uint("worst-case tokenURI gas", used);
        emit log_named_uint("worst-case tokenURI bytes", bytes(uri).length);
        assertLt(used, 2_000_000, "the 2M hard gas limit");
        assertLt(bytes(uri).length, 20_000, "the 20,000 byte hard limit");
    }
}
