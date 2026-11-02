using ChiefOfStaff.Core.Models;
using Microsoft.EntityFrameworkCore;

namespace ChiefOfStaff.Data.Services;

public class BriefService(IDbContextFactory<AppDbContext> dbFactory)
{
    /// <summary>Returns the brief for the owner, or an unsaved empty one.</summary>
    public async Task<ContextBrief> GetAsync(BriefScope scope, int ownerId)
    {
        await using var db = await dbFactory.CreateDbContextAsync();
        return await db.ContextBriefs.FirstOrDefaultAsync(c => c.Scope == scope && c.OwnerId == ownerId)
               ?? new ContextBrief { Scope = scope, OwnerId = ownerId };
    }

    public async Task SaveAsync(ContextBrief brief)
    {
        await using var db = await dbFactory.CreateDbContextAsync();
        var existing = await db.ContextBriefs.FirstOrDefaultAsync(c => c.Scope == brief.Scope && c.OwnerId == brief.OwnerId);
        if (existing is null)
        {
            existing = new ContextBrief { Scope = brief.Scope, OwnerId = brief.OwnerId };
            db.ContextBriefs.Add(existing);
        }
        existing.Summary = brief.Summary;
        existing.StandingInstructions = brief.StandingInstructions;
        existing.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
    }
}
