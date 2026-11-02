using ChiefOfStaff.Core.Models;
using ChiefOfStaff.Core.Services;

namespace ChiefOfStaff.Tests;

public class PriorityEngineTests
{
    private static readonly DateTime Now = new(2026, 11, 2, 9, 0, 0, DateTimeKind.Local);
    private readonly PriorityEngine _engine = new();
    private readonly PriorityWeights _weights = new();

    private static WorkItem Item(DateTime? due = null, Person? requester = null, int followUps = 0, double idleDays = 0) => new()
    {
        Title = "t",
        DueDate = due,
        Requester = requester,
        FollowUpCount = followUps,
        LastActivityAt = Now.AddDays(-idleDays).ToUniversalTime(),
    };

    [Fact]
    public void Overdue_outranks_due_next_week()
    {
        var overdue = _engine.Score(Item(due: Now.AddDays(-2)), _weights, Now);
        var nextWeek = _engine.Score(Item(due: Now.AddDays(7)), _weights, Now);
        Assert.True(overdue.Score > nextWeek.Score);
        Assert.Contains("overdue by 2 days", overdue.Rationale, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void High_weight_requester_raises_score()
    {
        var vip = _engine.Score(Item(requester: new Person { Name = "VP", PriorityWeight = 5 }), _weights, Now);
        var low = _engine.Score(Item(requester: new Person { Name = "Peer", PriorityWeight = 1 }), _weights, Now);
        Assert.True(vip.Score > low.Score);
        Assert.Contains("requested by VP", vip.Rationale, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Follow_ups_and_staleness_raise_score()
    {
        var pinged = _engine.Score(Item(followUps: 2, idleDays: 5), _weights, Now);
        var fresh = _engine.Score(Item(), _weights, Now);
        Assert.True(pinged.Score > fresh.Score);
        Assert.Contains("2 follow-ups", pinged.Rationale, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Score_stays_within_0_to_100()
    {
        var max = _engine.Score(Item(due: Now.AddDays(-30), requester: new Person { Name = "X", PriorityWeight = 5 }, followUps: 10, idleDays: 90), _weights, Now);
        Assert.Equal(100, max.Score);
        var zeroWeights = _engine.Score(Item(), new PriorityWeights { DueDate = 0, Requester = 0, Staleness = 0 }, Now);
        Assert.Equal(0, zeroWeights.Score);
    }

    [Fact]
    public void Override_wins_over_computed_score()
    {
        var item = Item(due: Now.AddDays(-1));
        _engine.Apply(item, _weights, Now);
        item.PriorityOverride = 10;
        Assert.Equal(10, item.EffectivePriority);
    }

    [Fact]
    public void No_signals_gives_explanatory_rationale()
    {
        var result = _engine.Score(Item(), _weights, Now);
        Assert.Equal("No deadline or urgency signals", result.Rationale);
    }
}
