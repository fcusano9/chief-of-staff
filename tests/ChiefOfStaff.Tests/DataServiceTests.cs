using ChiefOfStaff.Core.Models;
using ChiefOfStaff.Core.Services;
using ChiefOfStaff.Data;
using ChiefOfStaff.Data.Services;
using Microsoft.EntityFrameworkCore;

namespace ChiefOfStaff.Tests;

/// <summary>Runs the real services against a throwaway SQLite file with the real migrations.</summary>
public sealed class DataServiceTests : IDisposable
{
    private readonly string _folder = Path.Combine(Path.GetTempPath(), "cos-tests-" + Guid.NewGuid().ToString("N"));
    private readonly string _dbPath;
    private readonly DbFactory _factory;
    private readonly WorkItemService _tasks;
    private readonly ProjectService _projects;
    private readonly PersonService _people;
    private readonly BriefService _briefs;

    public DataServiceTests()
    {
        Directory.CreateDirectory(_folder);
        _dbPath = Path.Combine(_folder, "test.db");
        _factory = new DbFactory(new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={_dbPath};Pooling=False").Options);
        using (var db = _factory.CreateDbContext()) db.Database.Migrate();
        var settings = new SettingsService(Path.Combine(_folder, "settings.json"));
        _tasks = new WorkItemService(_factory, settings, new PriorityEngine());
        _projects = new ProjectService(_factory);
        _people = new PersonService(_factory);
        _briefs = new BriefService(_factory);
    }

    public void Dispose()
    {
        try { Directory.Delete(_folder, recursive: true); } catch (IOException) { }
    }

    [Fact]
    public async Task Task_without_project_is_allowed_and_scored()
    {
        var saved = await _tasks.SaveAsync(new WorkItem { Title = "Submit expense report", DueDate = DateTime.Today });
        var loaded = await _tasks.GetAsync(saved.Id);
        Assert.NotNull(loaded);
        Assert.Null(loaded.ProjectId);
        Assert.True(loaded.PriorityScore > 0);
        Assert.Contains("due today", loaded.PriorityRationale, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Subtasks_are_added_updated_and_removed()
    {
        var saved = await _tasks.SaveAsync(new WorkItem
        {
            Title = "Roadmap slides",
            Subtasks = [new() { Title = "Timeline" }, new() { Title = "Pricing" }],
        });
        var loaded = (await _tasks.GetAsync(saved.Id))!;
        Assert.Equal(["Timeline", "Pricing"], loaded.Subtasks.Select(s => s.Title));

        loaded.Subtasks = [new() { Id = loaded.Subtasks[1].Id, Title = "Pricing", IsDone = true }, new() { Title = "Send" }];
        await _tasks.SaveAsync(loaded);
        var reloaded = (await _tasks.GetAsync(saved.Id))!;
        Assert.Equal(["Pricing", "Send"], reloaded.Subtasks.Select(s => s.Title));
        Assert.True(reloaded.Subtasks[0].IsDone);
    }

    [Fact]
    public async Task Higher_priority_tasks_come_first_and_done_tasks_are_hidden()
    {
        var vip = await _people.SaveAsync(new Person { Name = "VP", PriorityWeight = 5 });
        await _tasks.SaveAsync(new WorkItem { Title = "Low" });
        await _tasks.SaveAsync(new WorkItem { Title = "High", DueDate = DateTime.Today.AddDays(-1), RequesterId = vip.Id });
        var done = await _tasks.SaveAsync(new WorkItem { Title = "Finished" });
        await _tasks.SetStatusAsync(done.Id, WorkItemStatus.Done);

        var active = await _tasks.GetActiveAsync();
        Assert.Equal(["High", "Low"], active.Select(w => w.Title));
    }

    [Fact]
    public async Task Waiting_on_records_since_date()
    {
        var saved = await _tasks.SaveAsync(new WorkItem { Title = "Pricing input", Status = WorkItemStatus.WaitingOn, WaitingOn = "Finance" });
        Assert.NotNull(saved.WaitingSince);
        Assert.Single(await _tasks.GetWaitingAsync());

        saved.Status = WorkItemStatus.Open;
        var reopened = await _tasks.SaveAsync(saved);
        Assert.Null(reopened.WaitingSince);
    }

    [Fact]
    public async Task Deleting_project_keeps_its_tasks_without_project()
    {
        var project = await _projects.SaveAsync(new Project { Name = "Roadmap", ColorHex = "#7F77DD" });
        var task = await _tasks.SaveAsync(new WorkItem { Title = "Slides", ProjectId = project.Id });
        await _briefs.SaveAsync(new ContextBrief { Scope = BriefScope.Project, OwnerId = project.Id, Summary = "Goal" });

        await _projects.DeleteAsync(project.Id);

        var reloaded = await _tasks.GetAsync(task.Id);
        Assert.NotNull(reloaded);
        Assert.Null(reloaded.ProjectId);
        Assert.Equal("", (await _briefs.GetAsync(BriefScope.Project, project.Id)).Summary);
    }

    [Fact]
    public async Task Briefs_round_trip_per_owner()
    {
        await _briefs.SaveAsync(new ContextBrief { Scope = BriefScope.Project, OwnerId = 1, Summary = "Roadmap goal", StandingInstructions = "cc manager" });
        await _briefs.SaveAsync(new ContextBrief { Scope = BriefScope.Person, OwnerId = 1, Summary = "Prefers Teams" });
        await _briefs.SaveAsync(new ContextBrief { Scope = BriefScope.Project, OwnerId = 1, Summary = "Updated goal", StandingInstructions = "cc manager" });

        Assert.Equal("Updated goal", (await _briefs.GetAsync(BriefScope.Project, 1)).Summary);
        Assert.Equal("Prefers Teams", (await _briefs.GetAsync(BriefScope.Person, 1)).Summary);
    }

    [Fact]
    public async Task Backup_creates_readable_snapshot_and_prunes_old_ones()
    {
        await _tasks.SaveAsync(new WorkItem { Title = "Back me up" });
        var backups = Path.Combine(_folder, "backups");
        var service = new BackupService(_dbPath);
        for (var i = 0; i < 4; i++) service.CreateBackup(backups, keep: 2, nowLocal: new DateTime(2026, 11, 1 + i, 8, 0, 0));

        var files = Directory.GetFiles(backups).Select(Path.GetFileName).Order().ToList();
        Assert.Equal(["chiefofstaff-20261103-080000.db", "chiefofstaff-20261104-080000.db"], files);

        var snapshot = new DbFactory(new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite($"Data Source={Path.Combine(backups, files[1]!)};Pooling=False").Options);
        await using var db = snapshot.CreateDbContext();
        Assert.Equal("Back me up", (await db.WorkItems.SingleAsync()).Title);
    }

    private sealed class DbFactory(DbContextOptions<AppDbContext> options) : IDbContextFactory<AppDbContext>
    {
        public AppDbContext CreateDbContext() => new(options);
    }
}
