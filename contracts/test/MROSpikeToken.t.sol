// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";

import {MROSpikeToken} from "../src/spike/MROSpikeToken.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {TokenView} from "../src/render/TokenView.sol";

/// @notice Behaviour and access control for the spike's token contract.
/// @dev Per the project's smart-contract rules, every owner function has an
/// explicit test and every access-control revert has one too. The Ownable2Step
/// transfer flow is covered in full, including the window where the old owner
/// still holds control.
contract MROSpikeTokenTest is Test {
    MROSpikeToken t;
    Renderer r;

    address constant ALICE = address(0xA11CE);
    address constant MALLORY = address(0x4A11);

    /// @dev Token 1 on example.com, from tools/token-bitmap.mjs. The same 172
    /// bytes the renderer tests use.
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
    }

    function _mint(uint256 id) internal {
        t.mint(id, ALICE, bytes32(uint256(0xa9e)), _code());
    }

    // ---------------------------------------------------------------------
    // Minting
    // ---------------------------------------------------------------------

    function test_mintSetsDayOneState() public {
        _mint(1);
        TokenView memory v = t.viewOf(1);
        assertEq(t.ownerOf(1), ALICE);
        assertEq(v.level, 1);
        assertEq(v.streak, 1);
        // Compared against today() rather than a literal: Foundry starts the
        // clock at timestamp 1, so the day index is 0 and a literal would read
        // as a weak assertion when it is in fact exact.
        assertEq(v.lastDay, t.today());
        assertEq(v.mintDay, t.today());
        assertEq(v.agentKeyId, bytes32(uint256(0xa9e)));
        assertEq(v.code.length, 172);
    }

    function test_mintRejectsADuplicateId() public {
        _mint(1);
        vm.expectRevert(abi.encodeWithSelector(MROSpikeToken.TokenExists.selector, uint256(1)));
        _mint(1);
    }

    function test_mintRejectsAWrongLengthCode() public {
        vm.expectRevert(abi.encodeWithSelector(MROSpikeToken.BadCodeLength.selector, uint256(3)));
        t.mint(1, ALICE, bytes32(0), hex"aabbcc");
    }

    // ---------------------------------------------------------------------
    // Reads
    // ---------------------------------------------------------------------

    function test_tokenUriRevertsForAnUnmintedToken() public {
        vm.expectRevert(
            abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, uint256(9))
        );
        t.tokenURI(9);
    }

    function test_tokenUriRendersThroughTheRenderer() public {
        _mint(1);
        string memory uri = t.tokenURI(1);
        assertGt(bytes(uri).length, 5000, "the renderer produced nothing of substance");
        assertTrue(vm.contains(uri, "data:application/json;utf-8,{"), "not a utf-8 JSON data URI");
        assertTrue(vm.contains(uri, '"trait_type":"Agent Key"'), "the bound key is not in the metadata");
    }

    function test_viewOfCarriesSunsetPieceWide() public {
        _mint(1);
        assertFalse(t.viewOf(1).sunset, "a fresh piece is not sunset");
        t.sunset();
        assertTrue(t.viewOf(1).sunset, "sunset is piece-wide, not per token");
    }

    /// @dev The clock here reads day 0, which is exactly the case the spec's
    /// "sunsetDay == 0 means not sunset" sentinel cannot represent. Foundry
    /// starts at timestamp 1, so this is the default, not a contrived edge.
    function test_sunsetOnDayZeroIsStillSunset() public {
        assertEq(t.today(), 0, "this test is only meaningful on day zero");
        t.sunset();
        assertTrue(t.isSunset(), "a day-zero sunset must still register");
        assertEq(t.sunsetDay(), 0);
        vm.expectRevert(MROSpikeToken.AlreadySunset.selector);
        t.sunset();
    }

    function test_viewOfCarriesTheParentAndTheMarks() public {
        _mint(1);
        t.setMarks(1, 0x0A);
        t.setParent(1, 7);
        TokenView memory v = t.viewOf(1);
        assertEq(v.marks, 0x0A);
        assertEq(v.parent, 7);
    }

    function test_todayIsTheUtcDayIndex() public {
        vm.warp(86400 * 20123 + 55);
        assertEq(t.today(), 20123);
    }

    // ---------------------------------------------------------------------
    // Owner functions, happy path
    // ---------------------------------------------------------------------

    function test_setStateOverwritesAndEmitsMetadataUpdate() public {
        _mint(1);
        MROSpikeToken.Token memory s = MROSpikeToken.Token({
            level: 365, streak: 140, lastDay: 1000, mintDay: 900,
            generation: 1, seedsGiven: 2, resting: false, reserved: 0
        });
        // Neither ERC-4906 event has an indexed parameter, so only the data
        // field is checked. The events are declared on IERC4906.
        vm.expectEmit(false, false, false, true, address(t));
        emit IERC4906.MetadataUpdate(1);
        t.setState(1, s);

        TokenView memory v = t.viewOf(1);
        assertEq(v.level, 365);
        assertEq(v.streak, 140);
        assertEq(v.seedsGiven, 2);
        assertEq(v.generation, 1);
    }

    function test_setStateRevertsForAnUnmintedToken() public {
        MROSpikeToken.Token memory s;
        vm.expectRevert(
            abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, uint256(9))
        );
        t.setState(9, s);
    }

    function test_setMarksEmitsMetadataUpdate() public {
        _mint(1);
        vm.expectEmit(false, false, false, true, address(t));
        emit IERC4906.MetadataUpdate(1);
        t.setMarks(1, 0x0A);
    }

    function test_setParentEmitsMetadataUpdate() public {
        _mint(1);
        vm.expectEmit(false, false, false, true, address(t));
        emit IERC4906.MetadataUpdate(1);
        t.setParent(1, 7);
    }

    function test_touchRangeEmitsTheExactRange() public {
        vm.expectEmit(false, false, false, true, address(t));
        emit IERC4906.BatchMetadataUpdate(4, 9);
        t.touchRange(4, 9);
    }

    function test_touchRangeRejectsAnInvertedRange() public {
        vm.expectRevert(MROSpikeToken.BadRange.selector);
        t.touchRange(9, 4);
    }

    function test_touchRangeRefusesTheCollectionWideCatchAll() public {
        // Indexers treat a range ending at uint256 max as hostile; the spec
        // forbids it, so it is a revert rather than a comment.
        vm.expectRevert(MROSpikeToken.BadRange.selector);
        t.touchRange(1, type(uint256).max);
    }

    function test_setRendererSwapsTheRenderer() public {
        Renderer other = new Renderer();
        vm.expectEmit(false, false, false, true, address(t));
        emit MROSpikeToken.RendererSet(address(other));
        t.setRenderer(address(other));
        assertEq(t.renderer(), address(other));
    }

    function test_setRendererRejectsTheZeroAddress() public {
        vm.expectRevert(MROSpikeToken.ZeroRenderer.selector);
        t.setRenderer(address(0));
    }

    function test_theConstructorRejectsTheZeroAddress() public {
        vm.expectRevert(MROSpikeToken.ZeroRenderer.selector);
        new MROSpikeToken(address(0));
    }

    function test_sunsetIsIrreversible() public {
        vm.warp(86400 * 1000 + 1);
        t.sunset();
        assertTrue(t.isSunset());
        assertEq(t.sunsetDay(), 1000);
        vm.expectRevert(MROSpikeToken.AlreadySunset.selector);
        t.sunset();
    }

    // ---------------------------------------------------------------------
    // Access control: every owner function, called by a stranger
    // ---------------------------------------------------------------------

    function _expectNotOwner() internal {
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, MALLORY)
        );
    }

    function test_mintRevertsForANonOwner() public {
        vm.prank(MALLORY);
        _expectNotOwner();
        t.mint(1, MALLORY, bytes32(0), _code());
    }

    function test_setStateRevertsForANonOwner() public {
        _mint(1);
        MROSpikeToken.Token memory s;
        vm.prank(MALLORY);
        _expectNotOwner();
        t.setState(1, s);
    }

    function test_setMarksRevertsForANonOwner() public {
        _mint(1);
        vm.prank(MALLORY);
        _expectNotOwner();
        t.setMarks(1, 2);
    }

    function test_setParentRevertsForANonOwner() public {
        _mint(1);
        vm.prank(MALLORY);
        _expectNotOwner();
        t.setParent(1, 2);
    }

    function test_touchRangeRevertsForANonOwner() public {
        vm.prank(MALLORY);
        _expectNotOwner();
        t.touchRange(1, 2);
    }

    function test_setRendererRevertsForANonOwner() public {
        vm.prank(MALLORY);
        _expectNotOwner();
        t.setRenderer(address(1));
    }

    function test_sunsetRevertsForANonOwner() public {
        vm.prank(MALLORY);
        _expectNotOwner();
        t.sunset();
    }

    /// @dev Holding a token is not owning the contract. Worth its own test
    /// because it is the mistake an ERC-721 invites.
    function test_holdingATokenGrantsNoOwnerPowers() public {
        _mint(1);
        MROSpikeToken.Token memory s;
        vm.prank(ALICE);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, ALICE)
        );
        t.setState(1, s);
    }

    // ---------------------------------------------------------------------
    // Ownable2Step
    // ---------------------------------------------------------------------

    function test_ownershipTransferNeedsAcceptance() public {
        t.transferOwnership(ALICE);
        assertEq(t.owner(), address(this), "ownership must not move on the offer alone");
        assertEq(t.pendingOwner(), ALICE);

        vm.prank(ALICE);
        t.acceptOwnership();
        assertEq(t.owner(), ALICE);
        assertEq(t.pendingOwner(), address(0));
    }

    function test_onlyThePendingOwnerMayAccept() public {
        t.transferOwnership(ALICE);
        vm.prank(MALLORY);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, MALLORY)
        );
        t.acceptOwnership();
    }

    function test_transferOwnershipRevertsForANonOwner() public {
        vm.prank(MALLORY);
        _expectNotOwner();
        t.transferOwnership(MALLORY);
    }

    function test_theOldOwnerKeepsControlUntilAcceptance() public {
        t.transferOwnership(ALICE);
        t.touchRange(1, 2);   // still the owner: no revert
        assertEq(t.owner(), address(this));
    }

    function test_theNewOwnerHasControlAfterAcceptance() public {
        t.transferOwnership(ALICE);
        vm.prank(ALICE);
        t.acceptOwnership();

        vm.prank(ALICE);
        t.touchRange(1, 2);   // no revert

        _expectNotOwner();
        vm.prank(MALLORY);
        t.touchRange(1, 2);
    }

    // ---------------------------------------------------------------------
    // ERC-165 / ERC-4906
    // ---------------------------------------------------------------------

    function test_theAdvertisedInterfacesAreCorrect() public view {
        assertTrue(t.supportsInterface(0x49064906), "ERC-4906");
        assertTrue(t.supportsInterface(0x80ac58cd), "ERC-721");
        assertTrue(t.supportsInterface(0x5b5e139f), "ERC-721 Metadata");
        assertTrue(t.supportsInterface(0x01ffc9a7), "ERC-165");
        assertFalse(t.supportsInterface(0xdeadbeef), "an unknown id must be refused");
    }
}
