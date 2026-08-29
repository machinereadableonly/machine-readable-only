// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";

import {MROSpikeToken} from "../src/spike/MROSpikeToken.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {SpikeBitmaps} from "./SpikeBitmaps.sol";
import {SoakStates} from "./SoakStates.sol";

/// @notice Sweep D of the state soak: one token per state, all placed in a
/// single broadcast, so every visual state the piece can reach exists on a real
/// chain at once and can be read back over the public RPC.
///
/// @dev One token per state rather than one token cycled, because each token's
/// code encodes its OWN url -- reusing a bitmap would weaken the "decoded to its
/// own url" check to nothing. Twenty-six bitmaps come from
/// tools/spike-bitmaps.mjs.
///
/// The key is read here with vm.envUint rather than passed as --private-key, so
/// it never travels through a shell.
///
///   forge script script/SoakSepolia.s.sol:SoakSepolia --rpc-url base_sepolia --broadcast --slow
///
/// Then, once every state has been read back:
///
///   forge script script/SoakSepolia.s.sol:SoakSepolia --sig "closeThePiece(address)" <token> \
///     --rpc-url base_sepolia --broadcast
contract SoakSepolia is Script {
    function run() external returns (address renderer, address token) {
        uint256 key = vm.envUint("SPIKE_DEPLOYER_KEY");
        vm.startBroadcast(key);

        Renderer r = new Renderer();
        MROSpikeToken t = new MROSpikeToken(address(r));
        address to = vm.addr(key);
        uint32 today = t.today();

        SoakStates.State[] memory states = SoakStates.all();
        for (uint256 i; i < states.length; ++i) {
            SoakStates.State memory s = states[i];
            uint256 id = i + 1;

            t.mint(id, to, bytes32(id), SpikeBitmaps.code(id));

            // The fixture carries a lapse as a gap in days; the chain has its
            // own clock, so the gap is rebuilt against it rather than the
            // fixture's day 1000 being written literally.
            t.setState(id, MROSpikeToken.Token({
                level: s.level,
                streak: s.streak,
                lastDay: today > s.gap ? today - s.gap : 0,
                mintDay: today > s.level ? today - s.level : 0,
                generation: 0,
                seedsGiven: 0,
                resting: s.resting,
                reserved: 0
            }));
            if (s.marks != 0) t.setMarks(id, s.marks);
        }

        vm.stopBroadcast();

        console.log("renderer", address(r));
        console.log("token   ", address(t));
        console.log("states  ", states.length);
        return (address(r), address(t));
    }

    /// @notice The one state that cannot share a batch with the others.
    /// @dev Sunset is piece-wide and irreversible. Called inside `run` it would
    /// freeze all twenty-six tokens and every state read afterwards would be
    /// wrong, so it is applied only once the rest have been verified.
    function closeThePiece(address token) external {
        vm.startBroadcast(vm.envUint("SPIKE_DEPLOYER_KEY"));
        MROSpikeToken(token).sunset();
        vm.stopBroadcast();
        console.log("sunset applied; every token is now frozen");
    }
}
