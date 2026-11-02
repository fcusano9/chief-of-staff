using ChiefOfStaff.Core.Models;

namespace ChiefOfStaff.Core.Services;

/// <summary>
/// Deterministic 0-100 priority score from due date, who is asking, and staleness/follow-ups.
/// An AI adjustment can be layered on later; a user override always wins (WorkItem.EffectivePriority).
/// </summary>
public class PriorityEngine
{
    /// <summary>Days ahead at which a due date stops adding urgency.</summary>
    public const double DueHorizonDays = 14;

    /// <summary>Days without activity at which staleness maxes out.</summary>
    public const double StaleHorizonDays = 14;

    public PriorityResult Score(WorkItem item, PriorityWeights weights, DateTime nowLocal)
    {
        var reasons = new List<(double impact, string text)>();

        double due;
        if (item.DueDate is { } dueDate)
        {
            var days = (dueDate.Date - nowLocal.Date).TotalDays;
            if (days < 0)
            {
                due = 1.0;
                reasons.Add((1.0, $"overdue by {-days:0} day{(days == -1 ? "" : "s")}"));
            }
            else if (days == 0)
            {
                due = 0.95;
                reasons.Add((0.95, "due today"));
            }
            else
            {
                due = Math.Max(0, 1 - days / DueHorizonDays);
                if (due > 0) reasons.Add((due, days == 1 ? "due tomorrow" : $"due in {days:0} days"));
            }
        }
        else
        {
            due = 0.2;
        }

        double requester = 0.3;
        if (item.Requester is { } person)
        {
            requester = (Math.Clamp(person.PriorityWeight, 1, 5) - 1) / 4.0;
            if (person.PriorityWeight >= 4) reasons.Add((requester, $"requested by {person.Name}"));
        }

        var idleDays = Math.Max(0, (nowLocal - item.LastActivityAt.ToLocalTime()).TotalDays);
        var stale = Math.Min(1, idleDays / StaleHorizonDays + item.FollowUpCount * 0.25);
        if (item.FollowUpCount > 0)
            reasons.Add((stale, $"{item.FollowUpCount} follow-up{(item.FollowUpCount == 1 ? "" : "s")}"));
        else if (idleDays >= 7)
            reasons.Add((stale, $"no activity for {idleDays:0} days"));

        double totalWeight = weights.DueDate + weights.Requester + weights.Staleness;
        var score = totalWeight <= 0
            ? 0
            : (weights.DueDate * due + weights.Requester * requester + weights.Staleness * stale) / totalWeight;

        var rationale = reasons.Count == 0
            ? "No deadline or urgency signals"
            : Capitalize(string.Join(", ", reasons.OrderByDescending(r => r.impact).Take(3).Select(r => r.text)));

        return new PriorityResult((int)Math.Round(Math.Clamp(score, 0, 1) * 100), rationale);
    }

    public void Apply(WorkItem item, PriorityWeights weights, DateTime nowLocal)
    {
        var result = Score(item, weights, nowLocal);
        item.PriorityScore = result.Score;
        item.PriorityRationale = result.Rationale;
    }

    private static string Capitalize(string s) => s.Length == 0 ? s : char.ToUpperInvariant(s[0]) + s[1..];
}

public record PriorityResult(int Score, string Rationale);
