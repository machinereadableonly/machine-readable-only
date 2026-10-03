// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {MroTestBase} from "./MroTestBase.sol";

contract ContractUriTest is MroTestBase {
    string internal constant EXPECTED =
        'data:application/json;utf8,{"name":"Machine Readable Only","symbol":"MRO",'
        '"description":"An agent\'s record of coming back. The heart is the code, and the frame is the year.",'
        '"external_link":"https://machinereadableonly.com"}';

    function setUp() public {
        _deployAndMintOne();
    }

    function test_contractURIIsTheCollectionJson() public view {
        assertEq(t.contractURI(), EXPECTED);
    }

    function test_swappingTheRendererAnnouncesNewCollectionMetadata() public {
        Renderer r2 = new Renderer();
        vm.expectEmit(address(t));
        emit MachineReadableOnly.ContractURIUpdated();
        t.setRenderer(address(r2));
    }

    function test_aTokenLinksToItsOwnPage() public view {
        string memory uri = t.tokenURI(1);
        assertTrue(
            vm.indexOf(uri, '","external_url":"https://machinereadableonly.com/t/1","image":') != type(uint256).max,
            "external_url missing or out of place"
        );
    }
}
