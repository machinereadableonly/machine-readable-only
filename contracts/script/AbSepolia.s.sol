// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";

import {MROSpikeToken} from "../src/spike/MROSpikeToken.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {RendererUnsized} from "../src/render/RendererUnsized.sol";
import {SpikeBitmaps} from "./SpikeBitmaps.sol";
import {SoakStates} from "./SoakStates.sol";

/// @notice The intrinsic-size A/B, on Base Sepolia.
///
/// @dev Deploys the SAME twenty-six states twice, once behind the shipped
/// `Renderer` and once behind `RendererUnsized`, so a third-party CDN can be
/// pointed at both and the only difference between them is the `width`/`height`
/// attribute on the SVG. Anything else that differed would make the comparison
/// worthless, which is what `RendererSized.t.sol` exists to prevent.
///
/// The question it answered, and the reason it was worth a deploy: measured on
/// 2026-08-29, Alchemy's CDN rasterised the unsized SVG at its viewBox units --
/// 53 pixels -- then interpolated that bitmap up, and 54% of the results would
/// not decode against the sized build's 3.6%. The intrinsic size was adopted on
/// that evidence; this script is kept so the comparison can be re-run if a CDN
/// ever changes how it treats one.
/// See docs/2026-08-29-mro-third-party-raster-finding.md.
///
/// Nothing here is irreversible and nothing costs real money: Base Sepolia, from
/// a throwaway key. The key is read with vm.envUint rather than passed as
/// --private-key, so it never travels through a shell.
///
///   forge script script/AbSepolia.s.sol:AbSepolia --rpc-url base_sepolia --broadcast --slow
contract AbSepolia is Script {
    function run() external returns (address sizedToken, address unsizedToken) {
        uint256 key = vm.envUint("SPIKE_DEPLOYER_KEY");
        address to = vm.addr(key);

        vm.startBroadcast(key);

        Renderer sized = new Renderer();
        RendererUnsized unsized = new RendererUnsized();
        MROSpikeToken a = new MROSpikeToken(address(sized));
        MROSpikeToken b = new MROSpikeToken(address(unsized));

        _fill(a, to);
        _fill(b, to);

        vm.stopBroadcast();

        console.log("renderer sized  ", address(sized));
        console.log("renderer unsized", address(unsized));
        console.log("token    sized  ", address(a));
        console.log("token    unsized", address(b));
        console.log("states         ", SoakStates.COUNT);
        return (address(a), address(b));
    }

    /// @dev One token per state, each carrying its own bitmap, exactly as the
    /// sweep D script does. Both contracts get the identical set so a decode
    /// difference can only come from the renderer.
    function _fill(MROSpikeToken t, address to) private {
        uint32 today = t.today();
        SoakStates.State[] memory states = SoakStates.all();

        for (uint256 i; i < states.length; ++i) {
            SoakStates.State memory s = states[i];
            uint256 id = i + 1;

            t.mint(id, to, bytes32(id), SpikeBitmaps.code(id));

            // The fixture carries a lapse as a gap in days; the chain has its own
            // clock, so the gap is rebuilt against it rather than the fixture's
            // day 1000 being written literally.
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
    }
}
