// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Everything a renderer needs to draw one token, in one struct.
/// @dev Fixed before the renderers are written so they cannot disagree about
/// field names. `today` is passed in rather than read from block.timestamp so
/// every renderer is a pure function of its input and can be tested without
/// warping the clock.
struct TokenView {
    uint256 tokenId;
    uint32 level;        // credited days, total. level / 365 is completed years.
    uint32 streak;       // consecutive credited days at the last check-in
    uint32 lastDay;      // UTC day index of the last credited check-in
    uint32 mintDay;      // UTC day index of the mint
    uint32 generation;   // 0 for a founding token, 1+ for a seeded child
    uint32 seedsGiven;   // how many children this token has seeded
    bool resting;        // owner sealed it: the image is final and never pales
    bool sunset;         // operator closed the piece: same freeze, piece-wide
    uint256 marks;       // bit n set = mark id n (1 Vein .. 7 Singularity)
    bytes32 agentKeyId;  // which agent key minted it
    bytes code;          // 172 bytes, the packed 37x37 code, written once at mint
    uint32 today;        // UTC day index now, supplied by the token contract
}
