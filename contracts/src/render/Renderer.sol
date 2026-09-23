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
/// @dev The four drawing libraries each own one part of the picture and none of
/// them knows about the others; this is the only place that knows the order they
/// go in. That order is ghost, frame, noise, heart -- fixed so each library emits
/// one adjacent pair of paths and this contract can simply concatenate them.
/// All four sets are disjoint, so the order moves no pixel.
///
/// **The SVG is base64, the JSON is not.** Measured on the spike: base64-encoding
/// the SVG and serving the JSON as plain utf-8 costs 2,375,511 gas at the old
/// eighty-ring canvas, against 5,846,742 to percent-escape the SVG as utf-8 and
/// 3,210,443 to base64 the JSON as well. A per-byte escape loop in Solidity costs
/// far more than Solady's word-wise encoder, so base64 wins on gas by a factor of
/// 2.5 even though it is the larger payload.
///
/// **No raw `#` may reach the output.** The whole tokenURI is itself a URI, so a
/// raw hash opens a fragment and truncates the JSON -- measured, `JSON.parse`
/// fails at position 31. Base64 hides every `#` inside the SVG, including the
/// colours and Beat's `url(#b)`. The only one left is in the name, written
/// `%23`.
contract Renderer is IRenderer {
    /// @dev The quiet zone the code sits in, in cells, on each side.
    uint256 internal constant QUIET = 4;

    string internal constant NAME = "Machine Readable Only";
    string internal constant DESCRIPTION =
        "An agent's record of coming back. The heart is the code, and the frame is the year.";

    /// @inheritdoc IRenderer
    function tokenURI(TokenView memory v) external pure returns (string memory) {
        return string(
            abi.encodePacked(
                "data:application/json;utf-8,",
                '{"name":"', NAME, " %23", LibString.toString(v.tokenId), _suffix(v),
                '","description":"', DESCRIPTION,
                '","image":"data:image/svg+xml;base64,', Base64.encode(bytes(svg(v))),
                '","attributes":[', _attributes(v), "]}"
            )
        );
    }

    /// @notice The image on its own, before any encoding.
    /// @dev Public so a caller can read the raw SVG without paying for base64,
    /// and so the differential test can diff it against the JS reference.
    ///
    /// Split into `_head` and `_art` rather than written as one expression, so
    /// it compiles without the IR pipeline. `forge coverage` cannot use `via_ir`
    /// (foundry-rs/foundry#13001), and as a single `abi.encodePacked` this ran
    /// out of stack under the coverage profile.
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

    /// @dev The finisher's digit band, in the common unit, and 0 for every
    /// token that is not a finisher.
    ///
    /// Every layout expression that follows adds this, and each one reduces to
    /// exactly the expression it was before the band existed when it is 0 --
    /// which is what keeps a token that is not a finisher byte-identical, down
    /// to the single space before `viewBox`. That identity is the control the
    /// whole change rests on, and `TokenUriGolden` and `RenderMatrix` prove it.
    ///
    /// Computed once here rather than at each of the four places that need it:
    /// the band search is a short loop, but four of them on the `tokenURI` path
    /// is four too many.
    function _band(TokenView memory v) private pure returns (uint256) {
        if (MarkRenderer.ordinal(v.marks) == 0) return 0;
        return DigitBand.bandUnits(FrameRenderer.canvas(FrameRenderer.rings(v.level, v.echo)));
    }

    /// @dev The three reshaped finder patterns, drawn LAST -- over the noise,
    /// the frame and the heart -- so the erase-to-ground step lands cleanly
    /// even on a token wearing Static, whose green already recolours these
    /// same modules as ordinary code. Empty when no Iris is worn, so the
    /// finder patterns stay ordinary code modules exactly as they are today.
    ///
    /// @param rung the token's own live rung, from `_rung`.
    /// @dev The ink is computed through `inks()` at the EYE'S OWN RUNG, not
    /// necessarily `rung`, and then Break's exchange is applied through that
    /// call rather than by hand here. For the bought Iris the eye's rung is the
    /// token's live one. For the EARNED Iris it is the run stored when the Mark
    /// was applied -- frozen, the same rule `_rung` itself does not apply to
    /// this route. That is NOT for contrast against the noise: at the live
    /// rung the eye ink would be luminance-matched to the noise and still read
    /// fine, separated by hue the same way the heart and noise already are.
    /// The real reason is that the EARNED Iris must not lapse: reading the
    /// live rung would let its ink walk back down the ladder as the token's
    /// streak fades, which starts the one Mark that cannot be bought lapsing
    /// again -- exactly the property it exists to be free of. Computing it at
    /// the eye's own frozen rung keeps it still. Tint, when worn, overrides the
    /// ink outright either way.
    function _eyes(TokenView memory v, uint256 rung) private pure returns (string memory) {
        if (!MarkRenderer.has(v.marks, MarkRenderer.ANY_IRIS)) return "";
        // The EARNED Iris does not lapse: its rung comes from the run stored
        // at apply time, not the live rung, which is the whole point of the
        // Mark -- it stops tracking the lapse.
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

    /// @dev The rung this token sits on. A sealed or sunset token keeps the one
    /// it stopped at; a live one walks back down as it lapses. Kept here rather
    /// than in Palette so the palette stays a pure function of colour, not of
    /// token lifecycle.
    ///
    /// Returned as an INDEX, not a colour, because the heart ink and the noise
    /// ink must come from the same rung -- they are matched in luminance, and a
    /// mismatch stops the code decoding at large rasters. See Palette's header.
    /// @dev How long the token has been away, in days. C4.10.
    ///
    /// THE BRANCHES MIRROR `_rung` DELIBERATELY. Rest seals the image at the
    /// moment the owner chose, so a rested token's frame is final however long
    /// the calendar runs on; a FINISHED token's frame is final for the same
    /// reason; a sunset ages every token only to the day the PIECE closed, for
    /// the same reason the rung does. A gap rule that
    /// disagreed with the rung rule about when a token stopped would draw one
    /// token whose heart says kept and whose frame says gone.
    function _absence(TokenView memory v) private pure returns (uint256) {
        // A finished token's record is final: nothing it does not do can count
        // against it. It cannot check in again -- `_credit` refuses a token at
        // 365 -- so left on the live rule it would cool for ever. Spec 10f.
        if (v.resting || v.level >= FrameGeometry.DAY_CELLS) return 0;
        uint32 end = v.sunset ? v.sunsetDay : v.today;
        // A clock that runs backwards is not an absence. Guard the subtraction
        // rather than letting it wrap into a gap of four billion days.
        return end > v.lastDay ? end - v.lastDay : 0;
    }

    function _rung(TokenView memory v) private pure returns (uint256) {
        // Rest is the owner sealing the token at a chosen moment, and the
        // stored run IS that moment. Unchanged.
        if (v.resting) return Palette.tierIndex(v.streak);

        // A token that reached 365 is FINISHED, and its image is final. Not the
        // same thing as resting, and the difference is load-bearing: resting
        // blocks `seed`, so a piece that rested every token on completion could
        // never have a second generation. Spec 10f.
        bool whole = v.level >= FrameGeometry.DAY_CELLS;

        // A sunset seals every token at the day the PIECE closed, not at today.
        // Reading it as `today` would keep paling tokens after the record was
        // final; reading it as the stored run would un-pale a two-year-old
        // lapse and make every abandoned token look kept at the exact moment
        // the record is sealed forever. A sunset BEFORE the year ended seals it
        // there; after it, the finish already did.
        if (v.sunset && !whole) return Palette.lapsedIndex(v.streak, v.lastDay, v.sunsetDay);

        // A FINISHED token is read on the day it finished, forever: the same
        // rules as a live one, with the clock stopped at its last credited day.
        // Running the lapse rules with a stopped clock rather than short-
        // circuiting to `tierIndex` is what keeps a token that slipped during
        // its year from being un-paled by finishing it.
        uint32 at = whole ? v.lastDay : v.today;
        uint256 live = Palette.lapsedIndex(v.streak, v.lastDay, at);
        if (v.fellRun == 0) return live;

        // THE RUN THAT FELL STILL COLOURS THE TOKEN AS IT FADES. Without this a
        // missed day reset the run to 1 and snapped the heart to the day-one
        // colour at once, so a token that came back rendered PALER than one
        // that had been gone a month -- the piece rewarding the wrong thing.
        //
        // Capped one rung below the run that fell, because a slip must still
        // cost something the day it happens: uncapped, a token that missed a
        // day was indistinguishable from one that never had, and the served
        // copy says the colour goes.
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
    /// @dev SIXTEEN, adopted 2026-08-29 on a measured A/B rather than an
    /// argument. Two contracts carrying the same twenty-six states and the same
    /// bitmaps were deployed to Base Sepolia differing in nothing but this
    /// number, and Alchemy's own flattened PNGs were decoded off both:
    ///
    ///   unsized   30 of 56 constructed resizes failed (54%), pngUrl at 53px
    ///   sized     2 of 56 failed (3.6%),                    pngUrl at 848px
    ///
    /// The mechanism: with no intrinsic size their CDN rasterises the token at
    /// its viewBox units -- 53 pixels for a ONE-RING canvas, one pixel per
    /// cell -- and then interpolates THAT bitmap up to whatever width was asked
    /// for, arriving at 170 to 208 grey levels where the artwork has 3. A
    /// declared size moves their single rasterisation up to `canvas * 16` first,
    /// so what remains is a downscale of a crisp source. Cost, measured over
    /// RPC: about 1,600 gas and 32 bytes.
    ///
    /// Sixteen because it is the multiple this project already uses as its
    /// "exact multiple" control everywhere else, and because it puts a
    /// one-ring token at 848px and a two-ring token at 912px -- above the
    /// sizes third parties ask for, so their scaling is a downscale.
    ///
    /// Full write-up: docs/2026-08-29-mro-third-party-raster-finding.md
    ///
    /// Virtual and pure rather than an immutable, deliberately: an immutable
    /// would make `tokenURI` and `svg` view rather than pure, which changes
    /// IRenderer and every caller. `RendererUnsized` overrides it to 0 and is
    /// the control kept so this can be re-measured if a CDN changes.
    function pxPerCell() internal pure virtual returns (uint256) {
        return 16;
    }

    /// @dev The open tag, Beat's gradient definition, the field and Hush's tint.
    ///
    /// Emitted in two steps rather than one `abi.encodePacked`. Adding the
    /// intrinsic-size call to a single eleven-argument expression blew the IR
    /// pipeline's stack (`too deep by 2 slots`), the same wall `_attributes`
    /// already splits around.
    /// @param heartInk the heart ink, AFTER Break's exchange -- `defs`'s
    /// gradient near stop must move with the exchange too, so Break + Beat
    /// gives the noise ink rather than the token's own colour.
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
    /// `noiseInk` instead.
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

    /// @dev The finisher's number round the border, drawn in QR MODULES in its
    /// own group, outside everything else on the canvas.
    ///
    /// It is written in the ink of the finisher Mark the token holds -- the
    /// Mark IS the ink, see `MarkRenderer.finisherInk`. That is the token's
    /// PLACE, which is fixed for ever, and not the frame's fill or the token's
    /// colour, both of which move with the streak. The band is the one part of
    /// the picture that never moves after the day it is written.
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
    /// A frame cell and a QR module are the same size only at version 5; above
    /// it a cell is 13 units and a module is 9. Each is therefore drawn on its
    /// own grid inside a group carrying its own scale, which keeps every
    /// coordinate one or two digits. That is not cosmetic: `PathWriter`
    /// composes each run in a single 32-byte word with no slack at three
    /// digits a coordinate, and absolute units would reach 1,157 on the
    /// ten-ring canvas the piece used to allow -- and 741 on today's widest --
    /// and overrun the reservation.
    /// @param band the finisher's digit band, which the whole inner picture
    /// shifts in by. The empty string when there is none is LOAD-BEARING: it is
    /// what makes an unbanded token emit the exact bytes it emitted before the
    /// band existed.
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

    /// @dev `width="848" height="848"` when a size is declared, and the empty
    /// string when it is not -- so the unsized build emits the exact bytes it
    /// always has, down to the single space before `viewBox`.
    /// @param band the finisher's digit band. The expression below is exactly
    /// `canvas * k` when it is 0, because `units` is then `canvas * CELL_UNITS`
    /// and the division is exact -- so an unbanded token declares the size it
    /// always has.
    function _intrinsic(TokenView memory v, uint256 band) private pure returns (string memory) {
        uint256 k = pxPerCell();
        if (k == 0) return "";
        uint256 units = FrameRenderer.canvas(FrameRenderer.rings(v.level, v.echo))
            * FrameGeometry.CELL_UNITS + 2 * band;
        string memory px = LibString.toString(units * k / FrameGeometry.CELL_UNITS);
        return string(abi.encodePacked(' width="', px, '" height="', px, '"'));
    }

    /// @dev Voice tints the whole 45-cell block rather than the 656 cells of the
    /// quiet zone proper. The code modules are drawn on top, so the result is
    /// identical and it costs one rect instead of a path over 656 cells -- about
    /// 46 bytes against about 1,140.
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

    /// @dev The spec's attribute list, in the spec's order.
    ///
    /// `Heart` is filled cells over 365, `Children` is what the struct calls
    /// `seedsGiven`, and `Agent Key` is the bound key as fixed-width hex.
    /// `Parent` is 0 for a founding token. `Sunset` is the one entry the spec
    /// does not list; it is real piece-wide state a reader can act on, so it
    /// stays.
    ///
    /// Split in two because `abi.encodePacked` with fourteen arguments runs out
    /// of stack under the coverage profile, which cannot use the IR pipeline
    /// (foundry-rs/foundry#13001). `svg()` carries the same split for the same
    /// reason.
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
                // The finisher's PLACE, so an agent can read the rank without
                // rasterising the image and decoding a border. Emitted ALWAYS,
                // 0 included, the same rule `Echo` follows. It sits in
                // `_attrsA` rather than beside the other lifecycle attributes
                // because `_attrsB` is already at the stack limit under the
                // coverage profile, which cannot use the IR pipeline.
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
    /// shape (always "target") and an agent reading the JSON should not have
    /// to know that "absent means target". "Iris Run" is emitted for the
    /// EARNED route only, because it is the thing the bought route does not
    /// have.
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

    /// @dev The spec gives a whole token "(Whole)" and a sealed one "(At Rest)".
    /// Resting wins when both apply: it is the more final of the two states.
    /// A SUNSET token is at rest too -- the spec's own words are "every token
    /// then rests where it stands" -- and it used to read "(Whole)" or nothing.
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
