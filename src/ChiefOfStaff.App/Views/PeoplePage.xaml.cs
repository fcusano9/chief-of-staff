using ChiefOfStaff.App.ViewModels;
using ChiefOfStaff.Core.Models;
using ChiefOfStaff.Data.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;

namespace ChiefOfStaff.App.Views;

public sealed partial class PeoplePage : Page
{
    public record PersonRow(Person Person, int OpenCount)
    {
        public string Name => Person.Name;
        public double Weight => Person.PriorityWeight;
        public string Subtitle => string.Join(" · ", new[] { Person.Role, $"{OpenCount} open item{(OpenCount == 1 ? "" : "s")}" }
            .Where(s => !string.IsNullOrWhiteSpace(s)));
    }

    private Person? _editing;
    private bool _deleteArmed;

    public PeoplePage() => InitializeComponent();

    protected override async void OnNavigatedTo(NavigationEventArgs e) => await LoadAsync();

    private async Task LoadAsync(int? selectId = null)
    {
        var rows = (await App.Get<PersonService>().GetSummariesAsync()).Select(s => new PersonRow(s.Person, s.OpenCount)).ToList();
        PeopleList.ItemsSource = rows;
        EmptyText.Visibility = rows.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        var id = selectId ?? _editing?.Id;
        var selected = rows.FirstOrDefault(r => r.Person.Id == id) ?? (_editing is null ? rows.FirstOrDefault() : null);
        if (selected is not null) PeopleList.SelectedItem = selected;
        else if (_editing is { Id: 0 }) await ShowDetailAsync(_editing);
        else DetailCard.Visibility = Visibility.Collapsed;
    }

    private async void PeopleList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (PeopleList.SelectedItem is PersonRow row) await ShowDetailAsync(row.Person);
    }

    private async Task ShowDetailAsync(Person person)
    {
        _editing = person;
        _deleteArmed = false;
        DeleteButton.Content = "Delete person";
        DeleteButton.Visibility = person.Id == 0 ? Visibility.Collapsed : Visibility.Visible;
        NameBox.Text = person.Name;
        RoleBox.Text = person.Role ?? "";
        EmailBox.Text = person.Email ?? "";
        WeightBox.Value = person.PriorityWeight;
        StatusText.Text = "";

        var brief = person.Id == 0 ? new ContextBrief() : await App.Get<BriefService>().GetAsync(BriefScope.Person, person.Id);
        BriefSummaryBox.Text = brief.Summary;
        BriefInstructionsBox.Text = brief.StandingInstructions;

        PersonTasks.ItemsSource = person.Id == 0
            ? []
            : (await App.Get<WorkItemService>().GetForPersonAsync(person.Id)).Select(w => new TaskRowViewModel(w)).ToList();
        DetailCard.Visibility = Visibility.Visible;
    }

    private async void NewPerson_Click(object sender, RoutedEventArgs e)
    {
        PeopleList.SelectedItem = null;
        await ShowDetailAsync(new Person());
        NameBox.Focus(FocusState.Programmatic);
    }

    private async void Save_Click(object sender, RoutedEventArgs e)
    {
        if (_editing is null) return;
        if (string.IsNullOrWhiteSpace(NameBox.Text))
        {
            StatusText.Text = "Enter a name first.";
            return;
        }
        _editing.Name = NameBox.Text;
        _editing.Role = string.IsNullOrWhiteSpace(RoleBox.Text) ? null : RoleBox.Text.Trim();
        _editing.Email = string.IsNullOrWhiteSpace(EmailBox.Text) ? null : EmailBox.Text.Trim();
        _editing.PriorityWeight = WeightBox.Value < 1 ? 3 : (int)Math.Round(WeightBox.Value);
        var saved = await App.Get<PersonService>().SaveAsync(_editing);
        await App.Get<BriefService>().SaveAsync(new ContextBrief
        {
            Scope = BriefScope.Person,
            OwnerId = saved.Id,
            Summary = BriefSummaryBox.Text,
            StandingInstructions = BriefInstructionsBox.Text,
        });
        // A weight change affects the score of everything this person asked for.
        await App.Get<WorkItemService>().RecomputeAllAsync();
        _editing = saved;
        await LoadAsync(saved.Id);
        StatusText.Text = "Saved";
    }

    private async void Delete_Click(object sender, RoutedEventArgs e)
    {
        if (_editing is not { Id: > 0 }) return;
        if (!_deleteArmed)
        {
            _deleteArmed = true;
            DeleteButton.Content = "Click again to delete (their tasks are kept)";
            return;
        }
        await App.Get<PersonService>().DeleteAsync(_editing.Id);
        await App.Get<WorkItemService>().RecomputeAllAsync();
        _editing = null;
        await LoadAsync();
    }

    private async void Task_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is TaskRowViewModel row && await TaskDialog.ShowForAsync(XamlRoot, row.Id)) await LoadAsync(_editing?.Id);
    }
}
