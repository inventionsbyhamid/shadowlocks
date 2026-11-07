// Each box's dossier line: "Off the desk of <owner>. Inside: <loot>." Picked by the box's seed. The words
// live with the rest of the copy (COPY.story, in this order: the generator picks by place), where each
// language's table has them too.
import { COPY } from "../ui/copy";

export const OWNERS: string[] = [...COPY.story.owners];

export const LOOT: string[] = [...COPY.story.loot];
