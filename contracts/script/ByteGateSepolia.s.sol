// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {console} from "forge-std/Script.sol";

import {MroScript} from "./MroScript.sol";
import {ByteGateBitmap} from "./ByteGateBitmap.sol";

import {MROSpikeToken} from "../src/spike/MROSpikeToken.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {MarkRenderer} from "../src/render/MarkRenderer.sol";

/// @notice THE BYTE GATE: put the real byte worst case on a real chain, so a
/// third party can be asked whether it ingests a `data:` URI that size.
///
/// @dev WHY THIS EXISTS. The only external ceiling anyone documents is
/// Alchemy's, re-read live 2026-09-22:
///
///   "This can also happen if the content length of the response is larger
///    than 30 000 bytes."   -- https://www.alchemy.com/docs/reference/nft-api-faq
///
/// That sentence sits among reasons an HTTP-HOSTED metadata url fails to
/// FETCH, and the docs say nothing about `data:` URIs at all. So whether it
/// binds this piece has never been measured. What HAS been measured is a
/// 14,237-character token; what will ship is 23,046. This closes that gap.
///
/// WHY A SPIKE RATHER THAN THE REAL CONTRACT. The worst case carries a
/// FINISHER'S ORDINAL, and nothing writes those bits yet -- the finisher Marks
/// are unbuilt. `MROSpikeToken.setMarks` takes an arbitrary word, so the spike
/// can hold a state the real contract cannot reach until that ships. The spike
/// draws through the SAME Renderer, so the bytes are the real bytes; its view
/// lacks `sunsetDay`, `fellRun` and `fellDay`, which is worth a few bytes and
/// no more.
///
/// THIS IS A THROWAWAY ON BASE SEPOLIA. It is not the piece, it is not adopted,
/// and nothing reads it. Do not point anything at these addresses.
///
///   EXPECTED_CHAIN_ID=84532 forge script script/ByteGateSepolia.s.sol:ByteGateSepolia \
///     --rpc-url base_sepolia --broadcast --slow
contract ByteGateSepolia is MroScript {
    /// @dev The maximal legal Mark set for a WHOLE token, lifted from
    /// GasBudget.t.sol rather than restated: one Mark per pair, the leaf Iris
    /// shape at bits 16-23, which is the combination that draws the most.
    uint256 constant MAX_MARKS = MarkRenderer.HUSH | MarkRenderer.BEAT
        | MarkRenderer.IRIS_BOUGHT | MarkRenderer.VESSEL | MarkRenderer.TINT
        | (uint256(2) << 16);

    /// @dev The finisher's ordinal at bits 64-95. ONE, because a 0 glyph
    /// carries more ink than a 1, so fifteen zeros is the densest band a
    /// sixteen-bit ordinal can draw -- and it is also the first finisher, the
    /// one token certain to exist.
    uint256 constant WORST_ORDINAL = uint256(1) << 64;

    /// @dev Ten completed years, which is the ring cap. A child spends one of
    /// its ten slots on the echo ring, so this is nine drawn rings plus the
    /// echo -- the largest canvas the piece can produce.
    uint32 constant LEVEL = 365 * 10;
    uint32 constant STREAK = 400;
    uint32 constant ECHO = 3650;

    function run() external returns (address renderer, address token) {
        // FIRST, before anything is read and long before any broadcast.
        guardChain();
        uint256 key = deployerKey();

        vm.startBroadcast(key);

        Renderer r = new Renderer();
        MROSpikeToken t = new MROSpikeToken(address(r));
        address to = vm.addr(key);

        t.mint(1, to, bytes32(uint256(0xa9e)), ByteGateBitmap.code());

        // lastDay is TODAY, not a fixture's 1000. A token last seen 19,700 days
        // ago has lapsed to the bottom rung and draws a different picture from
        // the one the budget measured -- which would quietly test the wrong
        // token.
        uint32 day = t.today();
        t.setState(1, MROSpikeToken.Token({
            level: LEVEL,
            streak: STREAK,
            lastDay: day,
            mintDay: day > LEVEL ? day - LEVEL : 0,
            generation: 1,
            seedsGiven: 0,
            resting: false,
            reserved: 0
        }));
        t.setParent(1, 1);
        t.setEcho(1, ECHO);
        t.setMarks(1, MAX_MARKS | WORST_ORDINAL);

        vm.stopBroadcast();

        // Read it back through the contract, so the number reported is what the
        // chain will serve rather than what this script believes it wrote.
        uint256 len = bytes(t.tokenURI(1)).length;

        console.log("renderer", address(r));
        console.log("token   ", address(t));
        console.log("tokenURI bytes", len);
        console.log("Alchemy's documented ceiling is 30000 -- for HTTP fetches,");
        console.log("which is the thing this deploy exists to test for a data URI.");

        return (address(r), address(t));
    }
}
