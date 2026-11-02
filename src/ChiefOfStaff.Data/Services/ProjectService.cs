using ChiefOfStaff.Core.Models;
using Microsoft.EntityFrameworkCore;

namespace ChiefOfStaff.Data.Services;

public class ProjectService(IDbContextFactory<AppDbContext> dbFactory)
{
    public async Task<List<ProjectSummary>> GetSummariesAsync()
    {
        await using var db = await dbFactory.CreateDbContextAsync();
        return await db.Projects
            .Where(p => p.Status != ProjectStatus.Archived)
            .OrderBy(p => p.Name)
            .Select(p => new ProjectSummary(p, p.WorkItems.Count(w =>
                w.Status == WorkItemStatus.Open || w.Status == WorkItemStatus.InProgress || w.Status == WorkItemStatus.WaitingOn)))
            .ToListAsync();
    }

    public async Task<List<Project>> GetActiveAsync()
    {
        await using var db = await dbFactory.CreateDbContextAsync();
        return await db.Projects.Where(p => p.Status != ProjectStatus.Archived).OrderBy(p => p.Name).ToListAsync();
    }

    public async Task<Project> SaveAsync(Project project)
    {
        await using var db = await dbFactory.CreateDbContextAsync();
        project.Name = project.Name.Trim();
        var entity = project.Id == 0 ? null : await db.Projects.FindAsync(project.Id);
        if (entity is null)
        {
            entity = new Project();
            db.Projects.Add(entity);
        }
        entity.Name = project.Name;
        entity.ColorHex = project.ColorHex;
        entity.Status = project.Status;
        await db.SaveChangesAsync();
        project.Id = entity.Id;
        return entity;
    }

    /// <summary>Deletes the project; its tasks become tasks with no project.</summary>
    public async Task DeleteAsync(int id)
    {
        await using var db = await dbFactory.CreateDbContextAsync();
        await db.WorkItems.Where(w => w.ProjectId == id).ExecuteUpdateAsync(s => s.SetProperty(w => w.ProjectId, (int?)null));
        await db.Projects.Where(p => p.Id == id).ExecuteDeleteAsync();
        await db.ContextBriefs.Where(c => c.Scope == BriefScope.Project && c.OwnerId == id).ExecuteDeleteAsync();
    }
}

public record ProjectSummary(Project Project, int OpenCount);
