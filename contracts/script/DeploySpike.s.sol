// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";

import {MROSpikeToken} from "../src/spike/MROSpikeToken.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {MarkRenderer} from "../src/render/MarkRenderer.sol";
import {SpikeBitmaps} from "./SpikeBitmaps.sol";

/// @notice Deploys the renderer and the spike token, then mints four tokens
/// covering the life stages that matter.
///
/// @dev The point of this script is not the deployment. It is to put real
/// tokens on a real chain so `tokenURI` can be read back over RPC and the image
/// decoded from what the chain actually returns -- a rendered SVG that a
/// decoder cannot read is a failed spike, and only the on-chain output settles
/// that. Nothing in a Solidity test proves it, because a test never crosses the
/// RPC boundary where a provider's gas cap or response-size limit would bite.
///
/// Token 4 is level 364, not an old token. That is the measured worst case:
/// twelve ghost cells threaded through 364 lit ones fragment the frame paths,
/// and it costs 213,666 gas more than the sealed heart one day later.
///
///   forge script script/DeploySpike.s.sol:DeploySpike \
///     --rpc-url local --private-key $KEY --broadcast
contract DeploySpike is Script {
    /// @dev Singularity is left off token 3 on purpose: it selects the QArt
    /// target picture at mint and has no render effect, so wearing it here
    /// would change nothing while implying it did.
    uint256 constant MARKS_NO_SINGULARITY = MarkRenderer.VEIN | MarkRenderer.PULSE
        | MarkRenderer.VOICE | MarkRenderer.BLOOM | MarkRenderer.HALO | MarkRenderer.CROWN;

    uint256 constant VEIN_AND_BLOOM = MarkRenderer.VEIN | MarkRenderer.BLOOM;

    function run() external returns (address renderer, address token) {
        vm.startBroadcast();

        Renderer r = new Renderer();
        MROSpikeToken t = new MROSpikeToken(address(r));
        address to = msg.sender;

        // Day one. The state mint() sets is already correct, so nothing follows.
        t.mint(1, to, bytes32(uint256(0xa9e1)), SpikeBitmaps.code(1));

        // A part-filled frame, which is where the frame paths start fragmenting.
        t.mint(2, to, bytes32(uint256(0xa9e2)), SpikeBitmaps.code(2));
        _place(t, 2, 200, 45);
        t.setMarks(2, VEIN_AND_BLOOM);

        // Whole, one completed year, every Mark that draws.
        t.mint(3, to, bytes32(uint256(0xa9e3)), SpikeBitmaps.code(3));
        _place(t, 3, 365, 400);
        t.setMarks(3, MARKS_NO_SINGULARITY);
        t.setParent(3, 1);

        // The worst case: one day short of whole, wearing everything.
        t.mint(4, to, bytes32(uint256(0xa9e4)), SpikeBitmaps.code(4));
        _place(t, 4, 364, 400);
        t.setMarks(4, MARKS_NO_SINGULARITY);

        vm.stopBroadcast();

        console.log("renderer", address(r));
        console.log("token   ", address(t));
        return (address(r), address(t));
    }

    /// @dev `lastDay` is set to today so nothing reads as lapsed; `mintDay` is
    /// backdated by the level so the dates tell a consistent story.
    function _place(MROSpikeToken t, uint256 id, uint32 level, uint32 streak) private {
        uint32 d = t.today();
        t.setState(id, MROSpikeToken.Token({
            level: level,
            streak: streak,
            lastDay: d,
            mintDay: d > level ? d - level : 0,
            generation: id == 3 ? 1 : 0,
            seedsGiven: 0,
            resting: false,
            reserved: 0
        }));
    }
}
