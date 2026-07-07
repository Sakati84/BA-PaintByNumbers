Meaning-first free-space refinement, 2026-07-07.

Goal:
Make the AI posterization understand what is important in the image before it simplifies large empty areas.

Rule:
- First identify what makes the image recognizable: the main subject, its silhouette, pose, structural parts, distinctive markings, and the places where it touches or overlaps its surroundings.
- If one clear main subject is surrounded by large simple areas such as sky, ground, road, water, wall, or floor, preserve the meaning-carrying subject parts first and simplify the empty areas second.
- Large free-space areas should become calm broad paint cells, but they must not absorb or erase important subject edges.
- Keep support, contact, attachment, opening, overlap, and lower-edge details as closed paint cells whenever they are needed to understand the subject.
- If an important part is dark and touches a dark surrounding area, separate it with clear value or hue changes using the allowed palette instead of letting it disappear.
- Preserve the count, placement, and readable separation of repeated or paired structural parts when they define the subject's identity, stance, support, movement, or function.

Negative prompt additions:
main subject absorbed by background, subject lost in empty space, important subject parts merged into background, meaning-carrying details lost, support details lost, contact details lost, lower edges lost, important openings lost, important overlaps lost, missing repeated structural parts, missing paired support parts

Reason:
The `img-2051` bus Expert case showed that the local Fresh pipeline cannot reliably recover important subject/support boundaries when the KI image already lets them merge into broad ground/shadow areas. The refinement is intentionally object-neutral; it should help any clear subject with surrounding free space instead of hard-coding one class of object.
