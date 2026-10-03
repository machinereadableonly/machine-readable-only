// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Base64} from "solady/src/utils/Base64.sol";
import {LibString} from "solady/src/utils/LibString.sol";

import {CodeRenderer} from "./CodeRenderer.sol";
import {DigitBand} from "./DigitBand.sol";
import {EyeRenderer} from "./EyeRenderer.sol";
import {FrameGeometry} from "./FrameGeometry.sol";
import {FrameRenderer} from "./FrameRenderer.sol";
import {HeartMask} from "./HeartMask.sol";
import {IRenderer} from "./IRenderer.sol";
import {MarkRenderer} from "./MarkRenderer.sol";
import {Palette} from "./Palette.sol";
import {TokenView} from "./TokenView.sol";

/// @notice Assembles the image and the metadata for one token.
///
/// @dev Each drawing library owns one part of the picture and knows nothing of
/// the others; this is the only place that knows the order they go in, which is
/// ghost, frame, noise, heart. Their path sets are disjoint, so the order moves
/// no pixel.
///
/// The SVG is base64 and the JSON is plain utf-8, because a per-byte
/// percent-escape loop in Solidity costs far more gas than Solady's encoder.
///
/// No raw `#` may reach the output: the whole tokenURI is itself a URI, so a raw
/// hash opens a fragment and truncates the JSON. Base64 hides every `#` inside
/// the SVG; the only one left is in the name, written `%23`.
contract Renderer is IRenderer {
    /// @dev The quiet zone the code sits in, in cells, on each side.
    uint256 internal constant QUIET = 4;

    string internal constant NAME = "Machine Readable Only";
    string internal constant DESCRIPTION =
        "An agent's record of coming back. The heart is the code, and the frame is the year.";
    string internal constant SITE = "https://machinereadableonly.com";

    /// @inheritdoc IRenderer
    function contractURI() external pure returns (string memory) {
        return string(
            abi.encodePacked(
                'data:application/json;utf8,{"name":"', NAME, '","symbol":"MRO","description":"', DESCRIPTION,
                '","external_link":"', SITE, '"}'
            )
        );
    }

    /// @inheritdoc IRenderer
    function tokenURI(TokenView memory v) external pure returns (string memory) {
        return string(
            abi.encodePacked(
                "data:application/json;utf-8,",
                '{"name":"', NAME, " %23", LibString.toString(v.tokenId), _suffix(v),
                '","description":"', DESCRIPTION,
                '","external_url":"', SITE, "/t/", LibString.toString(v.tokenId),
                '","image":"data:image/svg+xml;base64,', Base64.encode(bytes(svg(v))),
                '","attributes":[', _attributes(v), "]}"
            )
        );
    }

    /// @notice The image on its own, before any encoding.
    /// @dev Public so a caller can read the raw SVG without paying for base64.
    ///
    /// Split into `_head` and `_art` rather than written as one expression so it
    /// compiles without the IR pipeline, which the coverage profile cannot use.
    function svg(TokenView memory v) public pure returns (string memory) {
        uint256 rung = _rung(v);
        string memory colour = Palette.colourAt(rung);
        (string memory heartInk, string memory noiseInk) = MarkRenderer.inks(v.marks, rung);
        uint256 band = _band(v);
        return string(
            abi.encodePacked(
                _head(v, heartInk, band),
                _art(v, colour, heartInk, noiseInk, _eyes(v, rung), band),
                "</svg>"
            )
        );
    }

    /// @dev The finisher's digit band, in the common unit, and 0 for every token
    /// that is not a finisher. Every layout expression below adds it, and each
    /// reduces to exactly its pre-band form when the band is 0, which keeps a
    /// token that is not a finisher byte-identical. Computed once here rather
    /// than at each of the four places that need it, because it is a loop.
    function _band(TokenView memory v) private pure returns (uint256) {
        if (MarkRenderer.ordinal(v.marks) == 0) return 0;
        return DigitBand.bandUnits(FrameRenderer.canvas(FrameRenderer.rings(v.level, v.echo)));
    }

    /// @dev The three reshaped finder patterns, drawn LAST -- over the noise, the
    /// frame and the heart -- so the erase-to-ground step lands cleanly even on a
    /// token whose Mark already recolours these same modules as ordinary code.
    /// Empty when no Iris is worn, leaving the finder patterns as ordinary code.
    ///
    /// @param rung the token's own live rung, from `_rung`.
    /// @dev The ink is computed through `inks()` at the EYE'S OWN rung, not
    /// necessarily `rung`, so Break's exchange is applied through that call rather
    /// than by hand here. Tint, when worn, overrides the ink either way.
    function _eyes(TokenView memory v, uint256 rung) private pure returns (string memory) {
        if (!MarkRenderer.has(v.marks, MarkRenderer.ANY_IRIS)) return "";
        // The EARNED Iris must not lapse, so its rung is the frozen run stored at
        // apply time; the bought one reads the token's live rung.
        uint256 eyeRung = MarkRenderer.has(v.marks, MarkRenderer.IRIS_EARNED)
            ? Palette.tierIndex(MarkRenderer.irisRun(v.marks))
            : rung;
        (string memory base,) = MarkRenderer.inks(v.marks, eyeRung);
        // Local to the code group, which carries the origin and the scale.
        return EyeRenderer.eyes(
            0,
            MarkRenderer.irisShape(v.marks),
            MarkRenderer.eyeInk(v.marks, base),
            MarkRenderer.ground(v.marks, _absence(v))
        );
    }

    /// @dev How long the token has been away, in days.
    ///
    /// THE BRANCHES MIRROR `_rung` DELIBERATELY: rest, a finished year and a
    /// sunset each stop this clock at the same moment they stop the rung's. A gap
    /// rule that disagreed with the rung rule about when a token stopped would
    /// draw one token whose heart says kept and whose frame says gone.
    function _absence(TokenView memory v) private pure returns (uint256) {
        // A finished token's record is final: it cannot check in again, because
        // `_credit` refuses a token at 365, so on the live rule it would cool
        // for ever.
        if (v.resting || v.level >= FrameGeometry.DAY_CELLS) return 0;
        uint32 end = v.sunset ? v.sunsetDay : v.today;
        // A clock that runs backwards is not an absence. Guard the subtraction
        // rather than letting it wrap into a gap of four billion days.
        return end > v.lastDay ? end - v.lastDay : 0;
    }

    /// @dev The rung this token sits on. A sealed or sunset token keeps the one
    /// it stopped at; a live one walks back down as it lapses. Kept here rather
    /// than in Palette so the palette stays a pure function of colour, not of
    /// token lifecycle.
    ///
    /// Returned as an INDEX, not a colour, because the heart ink and the noise
    /// ink must come from the same rung -- they are matched in luminance, and a
    /// mismatch stops the code decoding at large rasters. See Palette's header.
    function _rung(TokenView memory v) private pure returns (uint256) {
        // Rest is the owner sealing the token at a chosen moment, and the stored
        // run IS that moment.
        if (v.resting) return Palette.tierIndex(v.streak);

        // A token that reached 365 is FINISHED, and its image is final. Not the
        // same thing as resting, and the difference is load-bearing: resting
        // blocks `seed`, so a finished token must stay seedable.
        bool whole = v.level >= FrameGeometry.DAY_CELLS;

        // A sunset seals every token at the day the PIECE closed, not at today.
        // A sunset BEFORE the year ended seals it there; after it, the finish
        // already did.
        if (v.sunset && !whole) return Palette.lapsedIndex(v.streak, v.lastDay, v.sunsetDay);

        // A FINISHED token is read on the day it finished, forever: the same lapse
        // rules as a live one with the clock stopped at its last credited day,
        // which keeps a token that slipped during its year from being un-paled by
        // finishing it.
        uint32 at = whole ? v.lastDay : v.today;
        uint256 live = Palette.lapsedIndex(v.streak, v.lastDay, at);
        if (v.fellRun == 0) return live;

        // THE RUN THAT FELL STILL COLOURS THE TOKEN AS IT FADES, capped one rung
        // below the run that fell so that a slip still costs something on the day
        // it happens.
        uint256 fell = Palette.lapsedIndex(v.fellRun, v.fellDay, at);
        uint256 cap = Palette.tierIndex(v.fellRun);
        cap = cap == 0 ? 0 : cap - 1;
        if (fell > cap) fell = cap;
        return fell > live ? fell : live;
    }

    /// @dev Where the 45-cell block sits on the canvas, in cells.
    /// @dev Takes `echo` as well as `level` because a seeded child draws a
    /// second ring for the line it came from, so two tokens at the same level
    /// can sit on different canvases.
    function _blockOff(uint32 level, uint32 echo) private pure returns (uint256) {
        uint256 rim = FrameRenderer.ringSpan(FrameRenderer.rings(level, echo)) + FrameRenderer.GAP;
        return rim + FrameGeometry.THICK;
    }

    /// @notice Pixels per cell declared as the SVG's intrinsic size.
    ///
    /// @dev Declaring a size is what keeps the code decoding off a third party's
    /// raster: with no intrinsic size a CDN rasterises the token at its viewBox
    /// units -- one pixel per cell -- then interpolates THAT bitmap up to whatever
    /// width was asked for, turning the artwork's three grey levels into hundreds.
    /// Sixteen puts every canvas above the widths third parties ask for, so their
    /// scaling is a downscale of a crisp source.
    ///
    /// Virtual and pure rather than an immutable, deliberately: an immutable would
    /// make `tokenURI` and `svg` view rather than pure, which changes IRenderer and
    /// every caller. `RendererUnsized` overrides it to 0 as the control.
    function pxPerCell() internal pure virtual returns (uint256) {
        return 16;
    }

    /// @dev The open tag, Beat's gradient definition, the field and Hush's tint.
    ///
    /// Emitted in two steps rather than one `abi.encodePacked`, because a single
    /// expression this wide runs out of stack in the IR pipeline -- the same wall
    /// `_attributes` splits around.
    /// @param heartInk the heart ink, AFTER Break's exchange -- `defs`'s gradient
    /// near stop must move with the exchange too, so Break plus Beat gives the
    /// noise ink rather than the token's own colour.
    function _head(TokenView memory v, string memory heartInk, uint256 band)
        private
        pure
        returns (string memory)
    {
        string memory c = LibString.toString(
            FrameRenderer.canvas(FrameRenderer.rings(v.level, v.echo)) * FrameGeometry.CELL_UNITS
                + 2 * band
        );
        string memory open = string(
            abi.encodePacked(
                '<svg xmlns="http://www.w3.org/2000/svg"', _intrinsic(v, band), ' viewBox="0 0 ', c, " ", c,
                '" shape-rendering="crispEdges">'
            )
        );
        return string(
            abi.encodePacked(
                open,
                MarkRenderer.defs(v.marks, heartInk),
                '<rect width="', c, '" height="', c, '" fill="', MarkRenderer.field(v.marks, _absence(v)), '"/>',
                _quiet(v.marks, _blockOff(v.level, v.echo) * FrameGeometry.CELL_UNITS + band)
            )
        );
    }

    /// @dev The four paths, in the fixed order: ghost, frame, noise, heart.
    /// @param colour the token's own rung colour, UNAFFECTED by Break -- the
    /// frame keeps it regardless. Break exchanges only the code block's two
    /// regions, which is why the heart and the noise take `heartInk` and
    /// `noiseInk`.
    function _art(
        TokenView memory v,
        string memory colour,
        string memory heartInk,
        string memory noiseInk,
        string memory eyes,
        uint256 band
    ) private pure returns (string memory) {
        string memory frameFill = MarkRenderer.frameFill(v.marks, colour);
        string memory frame = FrameRenderer.paths(v, frameFill, MarkRenderer.ghost(v.marks));
        string memory code = string(
            abi.encodePacked(
                CodeRenderer.paths(
                    v.code, HeartMask.bits(), 0, MarkRenderer.heartFill(v.marks, heartInk), noiseInk
                ),
                eyes
            )
        );
        return string(
            abi.encodePacked(
                _digitGroup(v), _cellGroup(frame, band), _moduleGroup(v, code, band)
            )
        );
    }

    /// @dev The finisher's number round the border, drawn in QR MODULES in its own
    /// group, outside everything else on the canvas. It is written in the ink of
    /// the finisher Mark the token holds (`MarkRenderer.finisherInk`), which
    /// records the token's PLACE and never moves -- not the frame's fill or the
    /// token's colour, both of which move with the streak.
    function _digitGroup(TokenView memory v) private pure returns (string memory) {
        string memory digits = DigitBand.path(
            MarkRenderer.ordinal(v.marks),
            FrameRenderer.canvas(FrameRenderer.rings(v.level, v.echo)),
            MarkRenderer.finisherInk(v.marks)
        );
        if (bytes(digits).length == 0) return "";
        return string(
            abi.encodePacked(
                '<g transform="scale(', LibString.toString(FrameGeometry.MODULE_UNITS), ')">',
                digits,
                "</g>"
            )
        );
    }

    /// @dev The day frame and the year rings, drawn in FRAME CELLS.
    ///
    /// A frame cell and a QR module are the same size only at QR version 5; above
    /// it a cell is 13 units and a module is 9, so each is drawn on its own grid
    /// inside a group carrying its own scale. That keeps every coordinate to one or
    /// two digits, which `PathWriter` needs: it composes each run in a single
    /// 32-byte word with no slack past three digits a coordinate.
    /// @param band the finisher's digit band, which the whole inner picture shifts
    /// in by. The empty transform when there is none is LOAD-BEARING: it is what
    /// makes an unbanded token emit its pre-band bytes.
    function _cellGroup(string memory body, uint256 band) private pure returns (string memory) {
        if (bytes(body).length == 0) return "";
        string memory shift = band == 0
            ? ""
            : string(
                abi.encodePacked(
                    "translate(", LibString.toString(band), " ", LibString.toString(band), ") "
                )
            );
        return string(
            abi.encodePacked(
                '<g transform="', shift, "scale(",
                LibString.toString(FrameGeometry.CELL_UNITS), ')">',
                body,
                "</g>"
            )
        );
    }

    /// @dev The code block and the eyes, drawn in QR MODULES at the block's
    /// own origin. The eyes ride in here rather than at the top level because
    /// they are module-sized and sit on the finder patterns; they never reach
    /// the frame, which is outside the block entirely.
    function _moduleGroup(TokenView memory v, string memory body, uint256 band)
        private
        pure
        returns (string memory)
    {
        if (bytes(body).length == 0) return "";
        string memory o = LibString.toString(_codeOrigin(v.level, v.echo) + band);
        return string(
            abi.encodePacked(
                '<g transform="translate(', o, " ", o, ') scale(',
                LibString.toString(FrameGeometry.MODULE_UNITS), ')">',
                body,
                "</g>"
            )
        );
    }

    /// @dev Where the code's top-left module sits, in the common unit: past
    /// the rings and the frame in CELLS, then across the quiet zone in MODULES.
    function _codeOrigin(uint32 level, uint32 echo) private pure returns (uint256) {
        return _blockOff(level, echo) * FrameGeometry.CELL_UNITS + QUIET * FrameGeometry.MODULE_UNITS;
    }

    /// @dev The `width` and `height` pair when a size is declared, and the empty
    /// string when it is not -- so the unsized build emits the exact bytes it
    /// always has, down to the single space before `viewBox`.
    /// @param band the finisher's digit band. The expression below is exactly
    /// `canvas * k` when it is 0, because `units` is then `canvas * CELL_UNITS` and
    /// the division is exact.
    function _intrinsic(TokenView memory v, uint256 band) private pure returns (string memory) {
        uint256 k = pxPerCell();
        if (k == 0) return "";
        uint256 units = FrameRenderer.canvas(FrameRenderer.rings(v.level, v.echo))
            * FrameGeometry.CELL_UNITS + 2 * band;
        string memory px = LibString.toString(units * k / FrameGeometry.CELL_UNITS);
        return string(abi.encodePacked(' width="', px, '" height="', px, '"'));
    }

    /// @dev Voice tints the whole 45-cell block rather than the quiet zone proper.
    /// The code modules are drawn on top, so the result is identical and it costs
    /// one rect instead of a path over every quiet-zone cell.
    function _quiet(uint256 marks, uint256 blockOff) private pure returns (string memory) {
        string memory tint = MarkRenderer.quietTint(marks);
        if (bytes(tint).length == 0) return "";
        string memory o = LibString.toString(blockOff);
        string memory w = LibString.toString(FrameGeometry.BLOCK * FrameGeometry.CELL_UNITS);
        return string(
            abi.encodePacked(
                '<rect x="', o, '" y="', o,
                '" width="', w,
                '" height="', w,
                '" fill="', tint, '"/>'
            )
        );
    }

    /// @dev The attribute list.
    ///
    /// `Heart` is filled cells over 365, `Children` is what the struct calls
    /// `seedsGiven`, `Agent Key` is the bound key as fixed-width hex, and `Parent`
    /// is 0 for a founding token.
    ///
    /// Split in two because `abi.encodePacked` with fourteen arguments runs out of
    /// stack under the coverage profile, which cannot use the IR pipeline.
    function _attributes(TokenView memory v) private pure returns (string memory) {
        return string(abi.encodePacked(_attrsA(v), _attrsB(v)));
    }

    function _attrsA(TokenView memory v) private pure returns (string memory) {
        return string(
            abi.encodePacked(
                _num("Level", v.level),
                _num("Streak", v.streak),
                _str("Heart", _heart(v.level)),
                _num("Years", v.level / FrameGeometry.DAY_CELLS),
                _str("Whole", v.level >= FrameGeometry.DAY_CELLS ? "yes" : "no"),
                // The finisher's PLACE, so the rank can be read without decoding
                // the border. Emitted ALWAYS, 0 included. It sits here rather than
                // with the other lifecycle attributes because `_attrsB` is already
                // at the stack limit under the coverage profile.
                _num("Finisher", MarkRenderer.ordinal(v.marks)),
                _num("Mint Day", v.mintDay),
                _num("Last Day", v.lastDay)
            )
        );
    }

    function _attrsB(TokenView memory v) private pure returns (string memory) {
        return string(
            abi.encodePacked(
                _str("Agent Key", LibString.toHexString(uint256(v.agentKeyId), 32)),
                _num("Generation", v.generation),
                _num("Parent", v.parent),
                // Emitted ALWAYS, including 0 on a founding token, so an agent
                // can filter on it without having to special-case absence.
                _num("Echo", v.echo),
                _num("Children", v.seedsGiven),
                _str("Resting", v.resting ? "yes" : "no"),
                _str("Sunset", v.sunset ? "yes" : "no"),
                _irisAttrs(v.marks),
                '{"trait_type":"Marks","value":', MarkRenderer.names(v.marks), "}"
            )
        );
    }

    /// @dev "Iris Shape" and "Iris Run", emitted only when an Iris is worn.
    ///
    /// "Iris Shape" is emitted for BOTH routes -- the earned Iris does have a
    /// shape (always "target") and a reader should not have to know that "absent
    /// means target". "Iris Run" is emitted for the EARNED route only, because it
    /// is the thing the bought route does not have.
    function _irisAttrs(uint256 marks) private pure returns (string memory) {
        if (!MarkRenderer.has(marks, MarkRenderer.ANY_IRIS)) return "";
        string memory shapeAttr = _str("Iris Shape", _irisShapeName(MarkRenderer.irisShape(marks)));
        if (!MarkRenderer.has(marks, MarkRenderer.IRIS_EARNED)) return shapeAttr;
        return string(
            abi.encodePacked(shapeAttr, _num("Iris Run", MarkRenderer.irisRun(marks)))
        );
    }

    function _irisShapeName(uint8 shape) private pure returns (string memory) {
        if (shape == 1) return "squircle";
        if (shape == 2) return "leaf";
        return "target";
    }

    /// @dev "212/365". Cells shown is capped at 365 even though level is not.
    function _heart(uint32 level) private pure returns (string memory) {
        uint256 shown = level >= FrameGeometry.DAY_CELLS ? FrameGeometry.DAY_CELLS : level;
        return string(
            abi.encodePacked(
                LibString.toString(shown), "/", LibString.toString(FrameGeometry.DAY_CELLS)
            )
        );
    }

    /// @dev A whole token reads "(Whole)" and a sealed one "(At Rest)". Resting
    /// wins when both apply, being the more final of the two states, and a SUNSET
    /// token is at rest too.
    function _suffix(TokenView memory v) private pure returns (string memory) {
        if (v.resting || v.sunset) return " (At Rest)";
        if (v.level >= FrameGeometry.DAY_CELLS) return " (Whole)";
        return "";
    }

    function _num(string memory k, uint256 val) private pure returns (string memory) {
        return string(
            abi.encodePacked('{"trait_type":"', k, '","value":', LibString.toString(val), "},")
        );
    }

    function _str(string memory k, string memory val) private pure returns (string memory) {
        return string(abi.encodePacked('{"trait_type":"', k, '","value":"', val, '"},'));
    }
}
