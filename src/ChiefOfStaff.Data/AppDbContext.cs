using ChiefOfStaff.Core.Models;
using Microsoft.EntityFrameworkCore;

namespace ChiefOfStaff.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<Person> People => Set<Person>();
    public DbSet<WorkItem> WorkItems => Set<WorkItem>();
    public DbSet<Subtask> Subtasks => Set<Subtask>();
    public DbSet<StatusUpdate> StatusUpdates => Set<StatusUpdate>();
    public DbSet<ContextBrief> ContextBriefs => Set<ContextBrief>();
    public DbSet<SourceItem> SourceItems => Set<SourceItem>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Project>().Property(p => p.Name).IsRequired();
        b.Entity<Person>().Property(p => p.Name).IsRequired();
        b.Entity<Person>().Ignore(p => p.Initials);

        b.Entity<WorkItem>(e =>
        {
            e.Property(w => w.Title).IsRequired();
            e.Ignore(w => w.EffectivePriority);
            e.Ignore(w => w.IsActive);
            e.HasOne(w => w.Project).WithMany(p => p.WorkItems).HasForeignKey(w => w.ProjectId)
                .OnDelete(DeleteBehavior.SetNull);
            e.HasOne(w => w.Requester).WithMany().HasForeignKey(w => w.RequesterId)
                .OnDelete(DeleteBehavior.SetNull);
            e.HasMany(w => w.Subtasks).WithOne().HasForeignKey(s => s.WorkItemId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(w => w.StatusUpdates).WithOne().HasForeignKey(s => s.WorkItemId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(w => w.Status);
        });

        b.Entity<ContextBrief>().HasIndex(c => new { c.Scope, c.OwnerId }).IsUnique();
        b.Entity<SourceItem>().HasIndex(s => s.ContentHash).IsUnique();
    }
}
