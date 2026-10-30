import { describe, expect, it } from "vitest";
import { castVote, openVote, resolveVote, voteSummary } from "../shared/vote";
import type { WorldState } from "../shared/world";

const chars = [{ id: "a", name: "Hagen" }, { id: "b", name: "Agnes" }, { id: "c", name: "Ulrich" }];
const fresh = () => ({}) as WorldState;

describe("Abstimmung", () => {
  it("braucht zwei verschiedene Antworten", () => {
    expect(openVote(fresh(), "Wohin?", ["Moor", "moor ", "Moor"])).toMatch(/zwei/);
    const w = fresh();
    expect(openVote(w, "Wohin?", ["Moor", "Pass", "Fluss", "Wald", "Berg"])).toBeNull();
    expect(w.vote!.options).toHaveLength(4);
  });

  it("Mehrheit gewinnt, Stimme änderbar, Ergebnis geht einmal an Claude", () => {
    const w = fresh();
    openVote(w, "Durchs Moor oder über den Pass?", ["Durchs Moor", "Über den Pass"]);
    expect(castVote(w, "a", 0)).toBeNull();
    expect(castVote(w, "b", 1)).toBeNull();
    expect(castVote(w, "c", 1)).toBeNull();
    expect(castVote(w, "c", 0)).toBeNull(); // umentschieden
    expect(castVote(w, "a", 7)).toMatch(/gibt es nicht/);
    expect(resolveVote(w, () => 0)).toEqual({ option: 0, counts: [2, 1], tie: false });
    expect(castVote(w, "b", 0)).toMatch(/keine Abstimmung/);
    const s = voteSummary(w, chars);
    expect(s).toContain("entschieden: Durchs Moor");
    expect(s).toContain("Agnes: Über den Pass");
    expect(w.vote).toBeNull();
  });

  it("Gleichstand oder keine Stimmen: der Würfel entscheidet", () => {
    const w = fresh();
    openVote(w, "Gefangenen freilassen?", ["Ja", "Nein"]);
    castVote(w, "a", 0); castVote(w, "b", 1);
    expect(resolveVote(w, () => 1)).toEqual({ option: 1, counts: [1, 1], tie: true });
    expect(voteSummary(w, chars)).toContain("Würfel");
    const empty = fresh();
    openVote(empty, "?", ["x", "y", "z"]);
    expect(resolveVote(empty, () => 2)?.option).toBe(2);
  });
});
