using ChiefOfStaff.Core.Models;
using ChiefOfStaff.Core.Services;
using Microsoft.EntityFrameworkCore;

namespace ChiefOfStaff.Data.Services;

public class WorkItemService(IDbContextFactory<AppDbContext> dbFactory, SettingsService settings, PriorityEngine priority)
{
    /// <summary>Active items (open, in progress, waiting) sorted by effective priority, highest first.</summary>
    public async Task<List<WorkItem>> GetActiveAsync(int? projectId = null, bool noProjectOnly = false, string? search = null)
    {
        await using var db = await dbFactory.CreateDbContextAsync();
        var query = WithDetails(db.WorkItems).Where(IsActiveExpr);
        if (projectId is { } pid) query = query.Where(w => w.ProjectId == pid);
        if (noProjectOnly) query = query.Where(w => w.ProjectId == null);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = "%" + search.Trim() + "%";
            query = query.Where(w => EF.Functions.Like(w.Title, pattern) || EF.Functions.Like(w.Notes ?? "", pattern));
        }
        var items = await query.ToListAsync();
        return items.OrderByDescending(w => w.EffectivePriority).ThenBy(w => w.DueDate ?? DateTime.MaxValue).ToList();
    }

    public async Task<List<WorkItem>> GetWaitingAsync()
    {
        await using var db = await dbFactory.CreateDbContextAsync();
        var items = await WithDetails(db.WorkItems).Where(w => w.Status == WorkItemStatus.WaitingOn).ToListAsync();
        return items.OrderBy(w => w.WaitingSince ?? w.LastActivityAt).ToList();
    }

    public async Task<List<WorkItem>> GetForPersonAsync(int personId)
    {
        await using var db = await dbFactory.CreateDbContextAsync();
        var items = await WithDetails(db.WorkItems).Where(IsActiveExpr).Where(w => w.RequesterId == personId).ToListAsync();
        return items.OrderByDescending(w => w.EffectivePriority).ToList();
    }

    public async Task<WorkItem?> GetAsync(int id)
    {
        await using var db = await dbFactory.CreateDbContextAsync();
        return await WithDetails(db.WorkItems).FirstOrDefaultAsync(w => w.Id == id);
    }

    /// <summary>Inserts or updates an item including its subtasks, and recomputes its priority.</summary>
    public async Task<WorkItem> SaveAsync(WorkItem item)
    {
        await using var db = await dbFactory.CreateDbContextAsync();

        WorkItem entity;
        if (item.Id == 0)
        {
            entity = new WorkItem();
            db.WorkItems.Add(entity);
        }
        else
        {
            entity = await db.WorkItems.Include(w => w.Subtasks).FirstAsync(w => w.Id == item.Id);
        }

        var enteringWaiting = item.Status == WorkItemStatus.WaitingOn && (entity.Id == 0 || entity.Status != WorkItemStatus.WaitingOn);
        var enteringDone = item.Status == WorkItemStatus.Done && (entity.Id == 0 || entity.Status != WorkItemStatus.Done);

        entity.Title = item.Title.Trim();
        entity.Notes = item.Notes;
        entity.Status = item.Status;
        entity.DueDate = item.DueDate?.Date;
        entity.ProjectId = item.ProjectId;
        entity.RequesterId = item.RequesterId;
        entity.PriorityOverride = item.PriorityOverride;
        entity.FollowUpCount = item.FollowUpCount;
        entity.WaitingOn = item.WaitingOn;
        entity.WaitingSince = item.Status != WorkItemStatus.WaitingOn ? null
            : enteringWaiting ? DateTime.UtcNow : entity.WaitingSince ?? DateTime.UtcNow;
        entity.CompletedAt = item.Status != WorkItemStatus.Done ? null
            : enteringDone ? DateTime.UtcNow : entity.CompletedAt;
        entity.LastActivityAt = DateTime.UtcNow;

        SyncSubtasks(db, entity, item.Subtasks);

        entity.Requester = entity.RequesterId is { } rid ? await db.People.FindAsync(rid) : null;
        priority.Apply(entity, settings.Current.PriorityWeights, DateTime.Now);
        await db.SaveChangesAsync();
        return entity;
    }

    public async Task SetStatusAsync(int id, WorkItemStatus status)
    {
        var item = await GetAsync(id) ?? throw new InvalidOperationException($"Work item {id} not found");
        item.Status = status;
        await SaveAsync(item);
    }

    public async Task DeleteAsync(int id)
    {
        await using var db = await dbFactory.CreateDbContextAsync();
        await db.WorkItems.Where(w => w.Id == id).ExecuteDeleteAsync();
        await db.ContextBriefs.Where(c => c.Scope == BriefScope.WorkItem && c.OwnerId == id).ExecuteDeleteAsync();
    }

    /// <summary>Recomputes scores for all active items (time moves on, weights change).</summary>
    public async Task RecomputeAllAsync()
    {
        await using var db = await dbFactory.CreateDbContextAsync();
        var items = await db.WorkItems.Include(w => w.Requester).Where(IsActiveExpr).ToListAsync();
        var now = DateTime.Now;
        foreach (var item in items) priority.Apply(item, settings.Current.PriorityWeights, now);
        await db.SaveChangesAsync();
    }

    public async Task<TodaySummary> GetTodaySummaryAsync()
    {
        await using var db = await dbFactory.CreateDbContextAsync();
        var active = await db.WorkItems.Where(IsActiveExpr)
            .Select(w => new { w.Status, w.DueDate, w.PriorityScore, w.PriorityOverride })
            .ToListAsync();
        var today = DateTime.Today;
        return new TodaySummary(
            Urgent: active.Count(a => (a.PriorityOverride ?? a.PriorityScore) >= 80),
            WaitingOn: active.Count(a => a.Status == WorkItemStatus.WaitingOn),
            Overdue: active.Count(a => a.DueDate is { } d && d.Date < today),
            Open: active.Count);
    }

    private static readonly System.Linq.Expressions.Expression<Func<WorkItem, bool>> IsActiveExpr = w =>
        w.Status == WorkItemStatus.Open || w.Status == WorkItemStatus.InProgress || w.Status == WorkItemStatus.WaitingOn;

    private static IQueryable<WorkItem> WithDetails(IQueryable<WorkItem> q) =>
        q.Include(w => w.Project).Include(w => w.Requester)
         .Include(w => w.Subtasks.OrderBy(s => s.SortOrder))
         .Include(w => w.StatusUpdates.OrderByDescending(s => s.CreatedAt));

    private static void SyncSubtasks(AppDbContext db, WorkItem entity, List<Subtask> desired)
    {
        var keepIds = desired.Where(s => s.Id != 0).Select(s => s.Id).ToHashSet();
        foreach (var removed in entity.Subtasks.Where(s => !keepIds.Contains(s.Id)).ToList())
        {
            entity.Subtasks.Remove(removed);
            db.Subtasks.Remove(removed);
        }
        for (var i = 0; i < desired.Count; i++)
        {
            var src = desired[i];
            var existing = src.Id == 0 ? null : entity.Subtasks.FirstOrDefault(s => s.Id == src.Id);
            if (existing is null)
            {
                existing = new Subtask();
                entity.Subtasks.Add(existing);
            }
            existing.Title = src.Title.Trim();
            existing.IsDone = src.IsDone;
            existing.SortOrder = i;
        }
    }
}

public record TodaySummary(int Urgent, int WaitingOn, int Overdue, int Open);
