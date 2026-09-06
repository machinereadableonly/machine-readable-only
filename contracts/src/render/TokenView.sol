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
    uint256 parent;      // 0 for a founding token, else the id it was seeded from
    bool resting;        // owner sealed it: the image is final and never pales
    bool sunset;         // operator closed the piece: same freeze, piece-wide
    uint32 sunsetDay;    // the day the piece closed; 0 while it is open
    uint16 fellRun;      // the run that most recently ended; 0 if none ever has
    uint24 fellDay;      // the day that run ended
    // ONE WORD, FOUR FIELDS. Bits 1-10 are the Mark ids in Ladder.sol's order
    // (1 Hush, 2 Ache, 3 Static, 4 Beat, 5 Iris bought, 6 Iris earned,
    // 7 Vessel, 8 Break, 9 Tint, 10 Aura); bit 0 is unused and is not a Mark.
    // Above them the same word carries the choices those Marks came with:
    //   bits 16-23  the Iris shape  (0 target, 1 squircle, 2 leaf)
    //   bits 24-31  the Tint ink    (0 violet, 1 gold)
    //   bits 32-63  the run the earned Iris was taken at
    // MarkRenderer is the only reader of the packing; nothing else should
    // shift this word by hand.
    uint256 marks;
    bytes32 agentKeyId;  // which agent key minted it
    bytes code;          // 172 bytes, the packed 37x37 code, written once at mint
    uint32 today;        // UTC day index now, supplied by the token contract
}
